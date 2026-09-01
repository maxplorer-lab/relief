import { authenticate } from "./auth";
import { getOrCreateAlbum, getOrCreateArtist, recount, trackById } from "./catalog";
import { encryptSecret, randomToken } from "./crypto";
import { contentTypeFor, safeSegment, suffixOf } from "./ids";
import { cors, jsonResponse, SubsonicError } from "./respond";
import { guessFromFilename, parseTags } from "./tags";
import type { Env } from "./types";

function jsonError(status: number, error: string): Response {
  return jsonResponse({ ok: false, error }, status);
}

async function readJson(request: Request): Promise<Record<string, unknown>> {
  try {
    return (await request.json()) as Record<string, unknown>;
  } catch {
    return {};
  }
}

export async function handleApi(request: Request, env: Env): Promise<Response> {
  const url = new URL(request.url);
  const path = url.pathname.replace(/\/+$/, "") || "/";

  if (request.method === "OPTIONS") {
    return new Response(null, { status: 204, headers: cors() });
  }

  if (path === "/api/setup") {
    if (request.method === "GET" || request.method === "HEAD") {
      return jsonResponse(
        {
          ok: false,
          error: "Setup is a POST, or open / and use the Setup tab",
          post: {
            setupSecret: "your SETUP_SECRET worker secret",
            users: [
              { username: "you", password: "strong", admin: true },
              { username: "plus-one", password: "strong" },
            ],
          },
        },
        405,
      );
    }
    if (request.method === "POST") return setup(request, env);
  }

  if (path === "/api/health") {
    const users = await env.DB.prepare("SELECT COUNT(*) AS n FROM users").first<{ n: number }>();
    const tracks = await env.DB.prepare("SELECT COUNT(*) AS n FROM tracks").first<{ n: number }>();
    return jsonResponse({
      ok: true,
      server: env.SERVER_NAME || "Relief",
      users: users?.n ?? 0,
      tracks: tracks?.n ?? 0,
      setupRequired: (users?.n ?? 0) === 0,
    });
  }

  let user;
  try {
    user = await authenticate(url, env);
  } catch (err) {
    if (err instanceof SubsonicError) return jsonError(err.code === 40 || err.code === 44 ? 401 : 400, err.message);
    return jsonError(401, "Unauthorized");
  }

  if (path === "/api/me") {
    return jsonResponse({
      ok: true,
      username: user.username,
      admin: user.is_admin === 1,
      apiKey: user.api_key,
    });
  }

  if (path === "/api/ingest" && request.method === "POST") {
    if (!user.is_admin) return jsonError(403, "Admin only");
    return ingest(request, env);
  }

  if (path === "/api/library") {
    const { results: albums } = await env.DB.prepare(
      `SELECT al.id, al.name, ar.name AS artist, al.year, al.song_count, al.duration_sec, al.genre
       FROM albums al JOIN artists ar ON ar.id = al.artist_id ORDER BY ar.name, al.year, al.name`,
    ).all();
    return jsonResponse({ ok: true, albums: albums ?? [] });
  }

  return jsonError(404, "Not found");
}

async function setup(request: Request, env: Env): Promise<Response> {
  if (!env.SETUP_SECRET) return jsonError(500, "SETUP_SECRET is not set");
  if (!env.AUTH_SECRET) return jsonError(500, "AUTH_SECRET is not set");
  const body = await readJson(request);
  if (body.setupSecret !== env.SETUP_SECRET) return jsonError(403, "Bad setup secret");

  const existing = await env.DB.prepare("SELECT COUNT(*) AS n FROM users").first<{ n: number }>();
  if ((existing?.n ?? 0) > 0) return jsonError(409, "Already initialized");

  const users = Array.isArray(body.users) ? body.users : [];
  if (users.length < 1 || users.length > 2) {
    return jsonError(400, "Provide 1 or 2 users: [{ username, password, admin? }]");
  }

  const created = [];
  for (const [i, u] of users.entries()) {
    const rec = u as { username?: string; password?: string; admin?: boolean };
    if (!rec.username || !rec.password) return jsonError(400, "Each user needs username and password");
    const enc = await encryptSecret(rec.password, env.AUTH_SECRET);
    const apiKey = `hb_${randomToken(24)}`;
    const admin = rec.admin === true || i === 0;
    await env.DB.prepare(
      "INSERT INTO users (username, password_enc, api_key, is_admin, created_at) VALUES (?, ?, ?, ?, ?)",
    )
      .bind(rec.username, enc, apiKey, admin ? 1 : 0, Date.now())
      .run();
    created.push({ username: rec.username, apiKey, admin });
  }
  return jsonResponse({ ok: true, users: created });
}

async function ingest(request: Request, env: Env): Promise<Response> {
  const ct = request.headers.get("content-type") || "";
  if (!ct.includes("multipart/form-data")) {
    return jsonError(400, "multipart/form-data required (file field + optional title/artist/album/track/year/genre/duration)");
  }
  const form = await request.formData();
  const file = form.get("file");
  if (!(file instanceof File)) return jsonError(400, "Missing file");

  const suffix = suffixOf(file.name);
  if (suffix !== "flac" && suffix !== "mp3") {
    return jsonError(400, "Only flac and mp3 are accepted");
  }

  const head = new Uint8Array(await file.slice(0, 512 * 1024).arrayBuffer());
  const tags = { ...guessFromFilename(file.name), ...parseTags(head) };

  const title = String(form.get("title") || tags.title || file.name);
  const artist = String(form.get("artist") || tags.artist || "Unknown Artist");
  const album = String(form.get("album") || tags.album || "Unknown Album");
  const trackNo = Number(form.get("track") || tags.track || 0) || null;
  const year = Number(form.get("year") || tags.year || 0) || null;
  const genre = String(form.get("genre") || tags.genre || "") || null;
  const duration = Number(form.get("duration") || tags.duration || 0) || 0;

  const artistId = await getOrCreateArtist(env, artist);
  const albumIdNum = await getOrCreateAlbum(env, artistId, album, year, genre);

  const key = `music/${safeSegment(artist)}/${safeSegment(album)}/${String(trackNo || 0).padStart(2, "0")} - ${safeSegment(title)}.${suffix}`;

  await env.MUSIC.put(key, file.stream(), {
    httpMetadata: { contentType: contentTypeFor(suffix) },
    customMetadata: { title, artist, album },
  });

  let coverKey: string | null = null;
  const cover = form.get("cover");
  if (cover instanceof File) {
    coverKey = `covers/al-${albumIdNum}`;
    await env.MUSIC.put(coverKey, cover.stream(), {
      httpMetadata: { contentType: cover.type || "image/jpeg" },
    });
  } else if (tags.cover) {
    coverKey = `covers/al-${albumIdNum}`;
    await env.MUSIC.put(coverKey, tags.cover.bytes, {
      httpMetadata: { contentType: tags.cover.mime },
    });
  }
  if (coverKey) {
    await env.DB.prepare("UPDATE albums SET cover_key = COALESCE(cover_key, ?) WHERE id = ?").bind(coverKey, albumIdNum).run();
    await env.DB.prepare("UPDATE artists SET cover_key = COALESCE(cover_key, ?) WHERE id = ?").bind(coverKey, artistId).run();
  }

  const existing = await env.DB.prepare("SELECT id FROM tracks WHERE r2_key = ?").bind(key).first<{ id: number }>();
  if (existing) {
    await env.DB.prepare(
      `UPDATE tracks SET title=?, track_no=?, year=?, genre=?, duration_sec=?, size_bytes=?, suffix=?, content_type=? WHERE id=?`,
    )
      .bind(title, trackNo, year, genre, duration, file.size, suffix, contentTypeFor(suffix), existing.id)
      .run();
  } else {
    await env.DB.prepare(
      `INSERT INTO tracks (album_id, artist_id, title, track_no, disc_no, year, genre, duration_sec, size_bytes, suffix, content_type, r2_key, play_count, created_at)
       VALUES (?, ?, ?, ?, 1, ?, ?, ?, ?, ?, ?, ?, 0, ?)`,
    )
      .bind(
        albumIdNum,
        artistId,
        title,
        trackNo,
        year,
        genre,
        duration,
        file.size,
        suffix,
        contentTypeFor(suffix),
        key,
        Date.now(),
      )
      .run();
  }

  await recount(env, artistId, albumIdNum);
  const row = await env.DB.prepare("SELECT id FROM tracks WHERE r2_key = ?").bind(key).first<{ id: number }>();
  const track = row ? await trackById(env, row.id) : null;
  return jsonResponse({ ok: true, track });
}
