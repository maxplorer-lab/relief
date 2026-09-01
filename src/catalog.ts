import { albumId, artistId, iso, trackId } from "./ids";
import type { AlbumRow, Env, TrackRow, UserRow } from "./types";

export async function getStarSet(
  env: Env,
  userId: number,
  type: string,
): Promise<Set<number>> {
  const { results } = await env.DB.prepare(
    "SELECT entity_id FROM stars WHERE user_id = ? AND entity_type = ?",
  )
    .bind(userId, type)
    .all<{ entity_id: number }>();
  return new Set((results ?? []).map((r) => r.entity_id));
}

export function songPayload(t: TrackRow, starred?: number | null) {
  return {
    id: trackId(t.id),
    parent: albumId(t.album_id),
    isDir: false,
    title: t.title,
    album: t.album_name,
    artist: t.artist_name,
    track: t.track_no ?? undefined,
    year: t.year ?? undefined,
    genre: t.genre ?? undefined,
    coverArt: albumId(t.album_id),
    size: t.size_bytes,
    contentType: t.content_type,
    suffix: t.suffix,
    duration: t.duration_sec,
    bitRate: t.bitrate ?? undefined,
    bitDepth: t.bit_depth ?? undefined,
    samplingRate: t.sample_rate ?? undefined,
    path: `${t.artist_name}/${t.album_name}/${t.title}.${t.suffix}`,
    playCount: t.play_count,
    played: iso(t.last_played),
    discNumber: t.disc_no ?? 1,
    created: iso(t.created_at),
    starred: iso(starred ?? t.starred_at),
    albumId: albumId(t.album_id),
    artistId: artistId(t.artist_id),
    type: "music",
    mediaType: "song",
  };
}

export function albumPayload(a: AlbumRow, extra: Record<string, unknown> = {}) {
  return {
    id: albumId(a.id),
    name: a.name,
    artist: a.artist_name,
    artistId: artistId(a.artist_id),
    coverArt: albumId(a.id),
    songCount: a.song_count,
    duration: a.duration_sec,
    playCount: a.play_count,
    created: iso(a.created_at),
    year: a.year ?? undefined,
    genre: a.genre ?? undefined,
    ...extra,
  };
}

export function artistPayload(a: { id: number; name: string; album_count: number; cover_key?: string | null }) {
  return {
    id: artistId(a.id),
    name: a.name,
    coverArt: artistId(a.id),
    albumCount: a.album_count,
  };
}

const TRACK_SELECT = `
  SELECT t.*, al.name AS album_name, ar.name AS artist_name, al.cover_key AS cover_key
  FROM tracks t
  JOIN albums al ON al.id = t.album_id
  JOIN artists ar ON ar.id = t.artist_id
`;

export async function trackById(env: Env, id: number): Promise<TrackRow | null> {
  return env.DB.prepare(`${TRACK_SELECT} WHERE t.id = ?`).bind(id).first<TrackRow>();
}

export async function tracksByAlbum(env: Env, albumIdNum: number): Promise<TrackRow[]> {
  const { results } = await env.DB.prepare(
    `${TRACK_SELECT} WHERE t.album_id = ? ORDER BY t.disc_no, t.track_no, t.title`,
  )
    .bind(albumIdNum)
    .all<TrackRow>();
  return results ?? [];
}

export async function albumById(env: Env, id: number): Promise<AlbumRow | null> {
  return env.DB.prepare(
    `SELECT al.*, ar.name AS artist_name FROM albums al JOIN artists ar ON ar.id = al.artist_id WHERE al.id = ?`,
  )
    .bind(id)
    .first<AlbumRow>();
}

export async function artistById(env: Env, id: number) {
  return env.DB.prepare("SELECT * FROM artists WHERE id = ?").bind(id).first<{
    id: number;
    name: string;
    album_count: number;
    song_count: number;
    cover_key: string | null;
  }>();
}

export async function albumsByArtist(env: Env, artistIdNum: number): Promise<AlbumRow[]> {
  const { results } = await env.DB.prepare(
    `SELECT al.*, ar.name AS artist_name FROM albums al JOIN artists ar ON ar.id = al.artist_id WHERE al.artist_id = ? ORDER BY al.year, al.name`,
  )
    .bind(artistIdNum)
    .all<AlbumRow>();
  return results ?? [];
}

export async function allArtists(env: Env) {
  const { results } = await env.DB.prepare("SELECT * FROM artists ORDER BY name COLLATE NOCASE").all<{
    id: number;
    name: string;
    album_count: number;
    cover_key: string | null;
  }>();
  return results ?? [];
}

export async function albumList(
  env: Env,
  type: string,
  size: number,
  offset: number,
  extra: { fromYear?: number; toYear?: number; genre?: string; user?: UserRow },
): Promise<AlbumRow[]> {
  const limit = Math.min(Math.max(size, 1), 500);
  const off = Math.max(offset, 0);
  let sql = `SELECT al.*, ar.name AS artist_name FROM albums al JOIN artists ar ON ar.id = al.artist_id`;
  const binds: (string | number)[] = [];
  const where: string[] = [];

  if (type === "byYear" && extra.fromYear && extra.toYear) {
    where.push("al.year BETWEEN ? AND ?");
    binds.push(extra.fromYear, extra.toYear);
  }
  if ((type === "byGenre" || extra.genre) && extra.genre) {
    where.push("al.genre = ?");
    binds.push(extra.genre);
  }
  if (type === "starred" && extra.user) {
    sql += ` JOIN stars st ON st.entity_id = al.id AND st.entity_type = 'album' AND st.user_id = ?`;
    binds.unshift(extra.user.id);
  }
  if (where.length) sql += ` WHERE ${where.join(" AND ")}`;

  switch (type) {
    case "newest":
      sql += " ORDER BY al.created_at DESC";
      break;
    case "frequent":
      sql += " ORDER BY al.play_count DESC, al.name";
      break;
    case "recent":
      sql += " ORDER BY CASE WHEN al.last_played IS NULL THEN 1 ELSE 0 END, al.last_played DESC";
      break;
    case "alphabeticalByName":
      sql += " ORDER BY al.name COLLATE NOCASE";
      break;
    case "alphabeticalByArtist":
      sql += " ORDER BY ar.name COLLATE NOCASE, al.name COLLATE NOCASE";
      break;
    case "starred":
      sql += " ORDER BY st.created_at DESC";
      break;
    case "byYear":
      sql += " ORDER BY al.year, al.name";
      break;
    case "byGenre":
      sql += " ORDER BY al.name COLLATE NOCASE";
      break;
    case "random":
    default:
      sql += " ORDER BY RANDOM()";
      break;
  }
  sql += " LIMIT ? OFFSET ?";
  binds.push(limit, off);
  const { results } = await env.DB.prepare(sql).bind(...binds).all<AlbumRow>();
  return results ?? [];
}

export async function searchTracks(env: Env, q: string, count: number, offset: number): Promise<TrackRow[]> {
  const like = `%${q}%`;
  const { results } = await env.DB.prepare(
    `${TRACK_SELECT} WHERE t.title LIKE ? OR ar.name LIKE ? OR al.name LIKE ? ORDER BY t.title LIMIT ? OFFSET ?`,
  )
    .bind(like, like, like, count, offset)
    .all<TrackRow>();
  return results ?? [];
}

export async function searchAlbums(env: Env, q: string, count: number, offset: number): Promise<AlbumRow[]> {
  const like = `%${q}%`;
  const { results } = await env.DB.prepare(
    `SELECT al.*, ar.name AS artist_name FROM albums al JOIN artists ar ON ar.id = al.artist_id
     WHERE al.name LIKE ? OR ar.name LIKE ? ORDER BY al.name LIMIT ? OFFSET ?`,
  )
    .bind(like, like, count, offset)
    .all<AlbumRow>();
  return results ?? [];
}

export async function searchArtists(env: Env, q: string, count: number, offset: number) {
  const like = `%${q}%`;
  const { results } = await env.DB.prepare(
    `SELECT * FROM artists WHERE name LIKE ? ORDER BY name LIMIT ? OFFSET ?`,
  )
    .bind(like, count, offset)
    .all<{ id: number; name: string; album_count: number; cover_key: string | null }>();
  return results ?? [];
}

export async function similarTracks(env: Env, seed: TrackRow, count: number): Promise<TrackRow[]> {
  const { results } = await env.DB.prepare(
    `${TRACK_SELECT} WHERE t.id != ? AND (t.artist_id = ? OR (t.genre IS NOT NULL AND t.genre = ?)) ORDER BY RANDOM() LIMIT ?`,
  )
    .bind(seed.id, seed.artist_id, seed.genre, count)
    .all<TrackRow>();
  return results ?? [];
}

export async function recount(env: Env, artistIdNum: number, albumIdNum: number): Promise<void> {
  await env.DB.batch([
    env.DB.prepare(
      `UPDATE albums SET song_count = (SELECT COUNT(*) FROM tracks WHERE album_id = ?),
        duration_sec = (SELECT COALESCE(SUM(duration_sec),0) FROM tracks WHERE album_id = ?)
       WHERE id = ?`,
    ).bind(albumIdNum, albumIdNum, albumIdNum),
    env.DB.prepare(
      `UPDATE artists SET
        album_count = (SELECT COUNT(*) FROM albums WHERE artist_id = ?),
        song_count = (SELECT COUNT(*) FROM tracks WHERE artist_id = ?)
       WHERE id = ?`,
    ).bind(artistIdNum, artistIdNum, artistIdNum),
  ]);
}

export async function getOrCreateArtist(env: Env, name: string): Promise<number> {
  const existing = await env.DB.prepare("SELECT id FROM artists WHERE name = ?").bind(name).first<{ id: number }>();
  if (existing) return existing.id;
  const res = await env.DB.prepare(
    "INSERT INTO artists (name, sort_name, album_count, song_count) VALUES (?, ?, 0, 0)",
  )
    .bind(name, name)
    .run();
  return Number(res.meta.last_row_id);
}

export async function getOrCreateAlbum(
  env: Env,
  artistIdNum: number,
  name: string,
  year: number | null,
  genre: string | null,
): Promise<number> {
  const existing = await env.DB.prepare("SELECT id FROM albums WHERE artist_id = ? AND name = ?")
    .bind(artistIdNum, name)
    .first<{ id: number }>();
  if (existing) return existing.id;
  const res = await env.DB.prepare(
    `INSERT INTO albums (artist_id, name, year, genre, song_count, duration_sec, created_at, play_count)
     VALUES (?, ?, ?, ?, 0, 0, ?, 0)`,
  )
    .bind(artistIdNum, name, year, genre, Date.now())
    .run();
  return Number(res.meta.last_row_id);
}
