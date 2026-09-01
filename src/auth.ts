import { decodeSubsonicPassword, decryptSecret, md5Hex } from "./crypto";
import { SubsonicError } from "./respond";
import type { Env, UserRow } from "./types";

function bearerToken(request: Request | undefined): string | null {
  const h = request?.headers.get("authorization") || "";
  if (/^bearer\s+/i.test(h)) return h.replace(/^bearer\s+/i, "").trim();
  if (/^basic\s+/i.test(h)) {
    try {
      const decoded = atob(h.replace(/^basic\s+/i, "").trim());
      const idx = decoded.indexOf(":");
      return idx >= 0 ? decoded.slice(idx + 1) : decoded;
    } catch {
      return null;
    }
  }
  return null;
}

export async function authenticate(url: URL, env: Env, request?: Request): Promise<UserRow> {
  if (!env.AUTH_SECRET) {
    throw new SubsonicError(0, "AUTH_SECRET is not set on this Worker");
  }

  const apiKey =
    url.searchParams.get("apiKey") ||
    url.searchParams.get("api_key") ||
    bearerToken(request);

  if (apiKey) {
    const row = await env.DB.prepare("SELECT * FROM users WHERE api_key = ?").bind(apiKey).first<UserRow>();
    if (!row) throw new SubsonicError(44, "Invalid API key");
    return row;
  }

  const username = url.searchParams.get("u");
  if (!username) throw new SubsonicError(10, "Required parameter missing: u");

  const row = await env.DB.prepare("SELECT * FROM users WHERE username = ?").bind(username).first<UserRow>();
  if (!row) throw new SubsonicError(40, "Wrong username or password");

  let password: string;
  try {
    password = await decryptSecret(row.password_enc, env.AUTH_SECRET);
  } catch {
    throw new SubsonicError(0, "Unable to decrypt stored password — check AUTH_SECRET");
  }

  const token = url.searchParams.get("t");
  const salt = url.searchParams.get("s");
  const p = url.searchParams.get("p");

  if (token && salt) {
    if (md5Hex(password + salt) !== token.toLowerCase()) {
      throw new SubsonicError(40, "Wrong username or password");
    }
    return row;
  }

  if (p) {
    const decoded = decodeSubsonicPassword(p);
    if (decoded === password) return row;
    if (row.api_key && (p === row.api_key || decoded === row.api_key)) return row;
    throw new SubsonicError(40, "Wrong username or password");
  }

  throw new SubsonicError(10, "Required parameter missing: p or t/s or apiKey");
}

export function userPayload(row: UserRow) {
  return {
    username: row.username,
    email: row.email || `${row.username}@relief.local`,
    scrobblingEnabled: true,
    adminRole: row.is_admin === 1,
    settingsRole: row.is_admin === 1,
    downloadRole: true,
    uploadRole: row.is_admin === 1,
    playlistRole: true,
    coverArtRole: row.is_admin === 1,
    commentRole: false,
    podcastRole: false,
    streamRole: true,
    jukeboxRole: false,
    shareRole: false,
    videoConversionRole: false,
    folder: [1],
  };
}
