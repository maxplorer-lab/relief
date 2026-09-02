export interface Env {
  DB: D1Database;
  MUSIC: R2Bucket;
  ASSETS?: Fetcher;
  SERVER_NAME: string;
  SERVER_VERSION: string;
  MUSIC_FOLDER_NAME: string;
  R2_BUCKET_NAME: string;
  AUTH_SECRET: string;
  SETUP_SECRET: string;
  R2_ACCOUNT_ID?: string;
  R2_ACCESS_KEY_ID?: string;
  R2_SECRET_ACCESS_KEY?: string;
}

export interface UserRow {
  id: number;
  username: string;
  password_enc: string;
  api_key: string | null;
  email: string | null;
  is_admin: number;
  created_at: number;
}

export interface ArtistRow {
  id: number;
  name: string;
  sort_name: string | null;
  cover_key: string | null;
  album_count: number;
  song_count: number;
}

export interface AlbumRow {
  id: number;
  artist_id: number;
  name: string;
  year: number | null;
  genre: string | null;
  cover_key: string | null;
  song_count: number;
  duration_sec: number;
  created_at: number;
  play_count: number;
  last_played: number | null;
  artist_name?: string;
}

export interface TrackRow {
  id: number;
  album_id: number;
  artist_id: number;
  title: string;
  track_no: number | null;
  disc_no: number | null;
  year: number | null;
  genre: string | null;
  duration_sec: number;
  bitrate: number | null;
  sample_rate: number | null;
  bit_depth: number | null;
  size_bytes: number;
  suffix: string;
  content_type: string;
  r2_key: string;
  play_count: number;
  last_played: number | null;
  created_at: number;
  album_name?: string;
  artist_name?: string;
  cover_key?: string | null;
  starred_at?: number | null;
}

export type AttrMap = Record<string, string | number | boolean | null | undefined>;
