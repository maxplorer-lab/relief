import { albumById, artistById, trackById } from "./catalog";
import { parseId } from "./ids";
import { cors, fail, formatOf, SubsonicError } from "./respond";
import type { Env } from "./types";

function parseRange(header: string | null, size: number): { offset: number; length: number; status: number } {
  if (!header || !header.startsWith("bytes=")) {
    return { offset: 0, length: size, status: 200 };
  }
  const spec = header.slice(6).split(",")[0]?.trim() ?? "";
  if (spec.startsWith("-")) {
    const suffix = Math.min(Number(spec.slice(1)) || 0, size);
    return { offset: size - suffix, length: suffix, status: 206 };
  }
  const [startS, endS] = spec.split("-");
  const start = Math.max(0, Number(startS) || 0);
  const end = endS === undefined || endS === "" ? size - 1 : Math.min(Number(endS), size - 1);
  if (start >= size || start > end) {
    return { offset: 0, length: size, status: 200 };
  }
  return { offset: start, length: end - start + 1, status: 206 };
}

export async function streamTrack(request: Request, env: Env, idRaw: string, download = false): Promise<Response> {
  const parsed = parseId(idRaw);
  if (!parsed || (parsed.kind !== "tr" && parsed.kind !== "al")) {
    throw new SubsonicError(70, "Requested data not found");
  }
  const track = parsed.kind === "tr" ? await trackById(env, parsed.n) : null;
  if (!track) throw new SubsonicError(70, "Requested data not found");

  const obj = await env.MUSIC.head(track.r2_key);
  if (!obj) throw new SubsonicError(70, "File missing from R2");

  const size = obj.size;
  const range = parseRange(request.headers.get("Range"), size);
  const body = await env.MUSIC.get(track.r2_key, {
    range: { offset: range.offset, length: range.length },
  });
  if (!body) throw new SubsonicError(70, "File missing from R2");

  const headers = new Headers({
    "content-type": track.content_type,
    "accept-ranges": "bytes",
    "content-length": String(range.length),
    "cache-control": "private, max-age=3600",
    ...cors(),
  });
  if (download) {
    headers.set("content-disposition", `attachment; filename="${track.title}.${track.suffix}"`);
  }
  if (range.status === 206) {
    headers.set("content-range", `bytes ${range.offset}-${range.offset + range.length - 1}/${size}`);
  }
  return new Response(body.body, { status: range.status, headers });
}

export async function coverArt(env: Env, idRaw: string): Promise<Response> {
  const parsed = parseId(idRaw);
  let key: string | null = null;
  if (parsed?.kind === "al") {
    const album = await albumById(env, parsed.n);
    key = album?.cover_key ?? null;
  } else if (parsed?.kind === "ar") {
    const artist = await artistById(env, parsed.n);
    key = artist?.cover_key ?? null;
  } else if (parsed?.kind === "tr") {
    const track = await trackById(env, parsed.n);
    if (track) {
      const album = await albumById(env, track.album_id);
      key = album?.cover_key ?? null;
    }
  }
  if (!key) {
    return svgCover(idRaw);
  }
  const obj = await env.MUSIC.get(key);
  if (!obj) return svgCover(idRaw);
  return new Response(obj.body, {
    headers: {
      "content-type": obj.httpMetadata?.contentType || "image/jpeg",
      "cache-control": "public, max-age=31536000, immutable",
      ...cors(),
    },
  });
}

function svgCover(seed: string): Response {
  let h = 0;
  for (let i = 0; i < seed.length; i++) h = (h * 33 + seed.charCodeAt(i)) >>> 0;
  const hue = h % 360;
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 400 400"><rect width="400" height="400" fill="#141412"/><circle cx="200" cy="200" r="118" fill="none" stroke="hsl(${hue} 12% 62%)" stroke-width="2"/><circle cx="200" cy="200" r="18" fill="hsl(${hue} 10% 72%)"/><rect x="40" y="40" width="320" height="320" fill="none" stroke="#2a2926" stroke-width="1"/></svg>`;
  return new Response(svg, {
    headers: { "content-type": "image/svg+xml", "cache-control": "public, max-age=86400", ...cors() },
  });
}

export async function handleBinary(
  request: Request,
  env: Env,
  method: string,
  url: URL,
): Promise<Response | null> {
  const fmt = formatOf(url);
  try {
    if (method === "stream" || method === "download") {
      const id = url.searchParams.get("id");
      if (!id) throw new SubsonicError(10, "Required parameter missing: id");
      return await streamTrack(request, env, id, method === "download");
    }
    if (method === "getcoverart" || method === "getavatar") {
      const id = url.searchParams.get("id") || url.searchParams.get("username") || "cover";
      return await coverArt(env, id);
    }
  } catch (err) {
    if (err instanceof SubsonicError) return fail(fmt, err.code, err.message, env);
    throw err;
  }
  return null;
}
