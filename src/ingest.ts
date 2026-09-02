import { getOrCreateAlbum, getOrCreateArtist, recount } from "./catalog";
import { contentTypeFor, suffixOf } from "./ids";
import { guessFromFilename, parseTags } from "./tags";
import type { Env } from "./types";

const HEAD_BYTES = 512 * 1024;

export interface ParsedMeta {
  title: string;
  artist: string;
  album: string;
  track: number | null;
  year: number | null;
  genre: string | null;
  duration: number;
}

export interface CoverInput {
  bytes: Uint8Array;
  mime: string;
}

export interface UpsertResult {
  trackId: number;
  status: "added" | "updated";
  artistId: number;
  albumId: number;
}

export interface IngestResult {
  status: "added" | "updated" | "skipped" | "error";
  trackId?: number;
  error?: string;
}

/**
 * Writes/updates the catalog rows (artist, album, track) for one file and
 * stores a cover if the album doesn't already have one. Shared by the
 * multipart upload endpoint and the R2 reconciler so both intake paths stay
 * in sync — this is the single place that owns "what a track row looks like".
 */
export async function upsertTrack(
  env: Env,
  key: string,
  suffix: string,
  size: number,
  etag: string | null,
  meta: ParsedMeta,
  cover?: CoverInput,
): Promise<UpsertResult> {
  const artistId = await getOrCreateArtist(env, meta.artist);
  const albumId = await getOrCreateAlbum(env, artistId, meta.album, meta.year, meta.genre);

  if (cover) {
    const albumRow = await env.DB.prepare("SELECT cover_key FROM albums WHERE id = ?")
      .bind(albumId)
      .first<{ cover_key: string | null }>();
    if (!albumRow?.cover_key) {
      const coverKey = `covers/al-${albumId}`;
      await env.MUSIC.put(coverKey, cover.bytes, { httpMetadata: { contentType: cover.mime } });
      await env.DB.prepare("UPDATE albums SET cover_key = COALESCE(cover_key, ?) WHERE id = ?").bind(coverKey, albumId).run();
      await env.DB.prepare("UPDATE artists SET cover_key = COALESCE(cover_key, ?) WHERE id = ?").bind(coverKey, artistId).run();
    }
  }

  const existing = await env.DB.prepare("SELECT id FROM tracks WHERE r2_key = ?").bind(key).first<{ id: number }>();
  let trackId: number;
  let status: "added" | "updated";

  if (existing) {
    await env.DB.prepare(
      `UPDATE tracks SET album_id=?, artist_id=?, title=?, track_no=?, year=?, genre=?, duration_sec=?, size_bytes=?, suffix=?, content_type=?, r2_etag=? WHERE id=?`,
    )
      .bind(
        albumId,
        artistId,
        meta.title,
        meta.track,
        meta.year,
        meta.genre,
        meta.duration,
        size,
        suffix,
        contentTypeFor(suffix),
        etag,
        existing.id,
      )
      .run();
    trackId = existing.id;
    status = "updated";
  } else {
    const res = await env.DB.prepare(
      `INSERT INTO tracks (album_id, artist_id, title, track_no, disc_no, year, genre, duration_sec, size_bytes, suffix, content_type, r2_key, r2_etag, play_count, created_at)
       VALUES (?, ?, ?, ?, 1, ?, ?, ?, ?, ?, ?, ?, ?, 0, ?)`,
    )
      .bind(
        albumId,
        artistId,
        meta.title,
        meta.track,
        meta.year,
        meta.genre,
        meta.duration,
        size,
        suffix,
        contentTypeFor(suffix),
        key,
        etag,
        Date.now(),
      )
      .run();
    trackId = Number(res.meta.last_row_id);
    status = "added";
  }

  await recount(env, artistId, albumId);
  return { trackId, status, artistId, albumId };
}

/** `music/Artist/Album/01 - Title.ext` — the same layout /api/ingest already writes. */
function hintsFromKey(key: string): { artist?: string; album?: string; title?: string; track?: number } {
  const parts = key.split("/");
  if (parts[0] !== "music" || parts.length < 4) return {};
  const decode = (s: string) => {
    try {
      return decodeURIComponent(s);
    } catch {
      return s;
    }
  };
  const artist = decode(parts[1]);
  const album = decode(parts[2]);
  const filename = decode(parts.slice(3).join("/")).replace(/\.[^.]+$/, "");
  const m = /^(\d+)\s*-\s*(.+)$/.exec(filename);
  if (m) {
    return { artist, album, title: m[2].trim(), track: parseInt(m[1], 10) || undefined };
  }
  return { artist, album, title: filename };
}

/**
 * Turns a bare R2 key into catalog rows: reads only the head bytes (matches
 * /api/ingest's own limit), parses embedded tags, falls back to the R2 path
 * layout, then to "Unknown Artist/Album". Skips non-audio keys (e.g.
 * standalone cover.jpg files) and unchanged files (same etag as last scan).
 */
export async function ingestObject(env: Env, key: string, etag: string | null): Promise<IngestResult> {
  const suffix = suffixOf(key);
  if (suffix !== "flac" && suffix !== "mp3") {
    return { status: "skipped" };
  }

  const existing = await env.DB.prepare("SELECT id, r2_etag FROM tracks WHERE r2_key = ?")
    .bind(key)
    .first<{ id: number; r2_etag: string | null }>();
  if (existing && etag && existing.r2_etag === etag) {
    return { status: "skipped", trackId: existing.id };
  }

  const obj = await env.MUSIC.get(key, { range: { offset: 0, length: HEAD_BYTES } });
  if (!obj) return { status: "error", error: "Object not found in R2" };

  try {
    const headBytes = new Uint8Array(await obj.arrayBuffer());
    const filename = key.split("/").pop() || key;
    const tags = { ...guessFromFilename(filename), ...hintsFromKey(key), ...parseTags(headBytes) };

    const meta: ParsedMeta = {
      title: tags.title || filename,
      artist: tags.artist || "Unknown Artist",
      album: tags.album || "Unknown Album",
      track: tags.track ?? null,
      year: tags.year ?? null,
      genre: tags.genre ?? null,
      duration: tags.duration ?? 0,
    };

    // obj.size reflects the ranged read; get the real object size from head().
    const head = await env.MUSIC.head(key);
    const size = head?.size ?? headBytes.length;

    const result = await upsertTrack(
      env,
      key,
      suffix,
      size,
      etag,
      meta,
      tags.cover ? { bytes: tags.cover.bytes, mime: tags.cover.mime } : undefined,
    );
    return { status: result.status, trackId: result.trackId };
  } catch (err) {
    return { status: "error", error: err instanceof Error ? err.message : String(err) };
  }
}
