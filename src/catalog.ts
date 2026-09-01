export interface AlbumRow {
  id: number;
  name: string;
  artist_name: unknown;
  artist_id: number;
  song_count?: number;
  duration_sec?: number;
  created_at?: number;
  year?: number;
  genre?: string;
  play_count?: number;
}

export interface TrackRow {
  id: number;
  album_id: number;
  title: string;
  album_name: string;
  artist_name: unknown;
  track_no?: number;
  year?: number;
  genre?: string;
  size_bytes: number;
  content_type?: string;
  suffix?: string;
  duration_sec: number;
  r2_key: string;
  disc_no?: number;
  created_at?: number;
  artist_id: number;
  play_count?: number;
}

function artistId(id: number): string {
  return `ar-${id}`;
}

function albumId(id: number): string {
  return `al-${id}`;
}

function trackId(id: number): string {
  return `tr-${id}`;
}

function iso(timestamp: number): string {
  return new Date(timestamp).toISOString();
}

// Helper to guarantee a standard primitive string (never a JSON array)
function toPrimitiveStr(val: unknown): string {
  if (Array.isArray(val)) return val.join(", ");
  if (val === null || val === undefined) return "";
  return String(val);
}

export function artistPayload(artist: { id: number; name: string; album_count?: number; cover_key?: string | null }) {
  return {
    id: artistId(artist.id),
    name: toPrimitiveStr(artist.name),
    albumCount: artist.album_count ?? 0,
    coverArt: artistId(artist.id),
  };
}

export function albumPayload(
  album: AlbumRow,
  extra?: { starred?: string },
) {
  return {
    id: albumId(album.id),
    name: album.name,
    artist: toPrimitiveStr(album.artist_name),
    artistId: artistId(album.artist_id),
    coverArt: albumId(album.id),
    songCount: album.song_count ?? 0,
    duration: album.duration_sec ?? 0,
    created: iso(album.created_at ?? Date.now()),
    year: album.year ?? undefined,
    genre: album.genre ?? undefined,
    playCount: album.play_count ?? 0,
    starred: extra?.starred,
  };
}

export function songPayload(track: TrackRow, starredAt?: number | null) {
  return {
    id: trackId(track.id),
    parent: albumId(track.album_id),
    isDir: false,
    title: track.title,
    album: track.album_name,
    artist: toPrimitiveStr(track.artist_name),
    track: track.track_no ?? undefined,
    year: track.year ?? undefined,
    genre: track.genre ?? undefined,
    coverArt: albumId(track.album_id),
    size: track.size_bytes,
    contentType: track.content_type || "audio/mpeg",
    suffix: track.suffix || "mp3",
    duration: track.duration_sec,
    bitRate: 320,
    path: track.r2_key,
    discNumber: track.disc_no || 1,
    created: iso(track.created_at || Date.now()),
    albumId: albumId(track.album_id),
    artistId: artistId(track.artist_id),
    type: "music",
    playCount: track.play_count || 0,
    starred: starredAt ? iso(starredAt) : undefined,
  };
}
