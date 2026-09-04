import type { Env } from "./types";

const USER_AGENT = "Relief-SelfHosted-MusicServer/0.2 (personal use)";

export interface LyricsResult {
  plain: string | null;
  synced: string | null; // raw LRC text, e.g. "[00:12.34]Some line"
  source: string;
}

export interface LyricsLine {
  start: number | null; // ms, null for unsynced lines
  value: string;
}

interface LrcLibTrack {
  duration?: number;
  plainLyrics?: string | null;
  syncedLyrics?: string | null;
}

async function lrclibLookup(artist: string, title: string, album?: string, duration?: number): Promise<LrcLibTrack | null> {
  try {
    const exact = new URLSearchParams({ artist_name: artist, track_name: title });
    if (album) exact.set("album_name", album);
    if (duration) exact.set("duration", String(Math.round(duration)));
    const res = await fetch(`https://lrclib.net/api/get?${exact}`, { headers: { "User-Agent": USER_AGENT } });
    if (res.ok) return (await res.json()) as LrcLibTrack;
  } catch {
    // fall through to fuzzy search
  }

  try {
    const search = new URLSearchParams({ artist_name: artist, track_name: title });
    const res = await fetch(`https://lrclib.net/api/search?${search}`, { headers: { "User-Agent": USER_AGENT } });
    if (!res.ok) return null;
    const results = (await res.json()) as LrcLibTrack[];
    if (!results.length) return null;
    if (!duration) return results[0];
    return results.reduce((best, cur) =>
      Math.abs((cur.duration ?? 0) - duration) < Math.abs((best.duration ?? 0) - duration) ? cur : best,
    );
  } catch {
    return null;
  }
}

/** Cache-first: reads D1, only calls out to lrclib.net on a genuine cache miss. */
export async function getOrFetchLyrics(
  env: Env,
  trackId: number,
  artist: string,
  title: string,
  album?: string,
  duration?: number,
): Promise<LyricsResult | null> {
  const cached = await env.DB.prepare("SELECT plain, synced, source FROM lyrics WHERE track_id = ?")
    .bind(trackId)
    .first<{ plain: string | null; synced: string | null; source: string }>();

  if (cached) {
    if (!cached.plain && !cached.synced) return null; // previously confirmed unavailable — don't refetch
    return cached;
  }

  const found = await lrclibLookup(artist, title, album, duration);
  const plain = found?.plainLyrics ?? null;
  const synced = found?.syncedLyrics ?? null;

  await env.DB.prepare(
    `INSERT INTO lyrics (track_id, plain, synced, source, fetched_at) VALUES (?, ?, ?, 'lrclib', ?)
     ON CONFLICT(track_id) DO UPDATE SET plain=excluded.plain, synced=excluded.synced, fetched_at=excluded.fetched_at`,
  )
    .bind(trackId, plain, synced, Date.now())
    .run();

  if (!plain && !synced) return null;
  return { plain, synced, source: "lrclib" };
}

/** Parses "[mm:ss.xx]text" LRC lines into {start (ms), value} pairs for OpenSubsonic's structuredLyrics. */
export function parseLrc(lrc: string): LyricsLine[] {
  const lineRe = /^\[(\d+):(\d+(?:\.\d+)?)\](.*)$/;
  const lines: LyricsLine[] = [];
  for (const raw of lrc.split(/\r?\n/)) {
    const m = lineRe.exec(raw.trim());
    if (!m) continue;
    const minutes = parseInt(m[1], 10);
    const seconds = parseFloat(m[2]);
    const start = Math.round((minutes * 60 + seconds) * 1000);
    const value = m[3].trim();
    if (value) lines.push({ start, value });
  }
  return lines;
}