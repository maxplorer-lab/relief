import type { Env } from "./types";

const NS = "http://subsonic.org/restapi";
const API_VERSION = "1.16.1";

/** OpenSubsonic/Navidrome clients treat a bare object as “one item”, not a list. */
const ARRAY_KEYS = new Set([
  "album",
  "song",
  "artist",
  "child",
  "entry",
  "index",
  "genre",
  "playlist",
  "musicFolder",
  "similarArtist",
  "user",
  "openSubsonicExtensions",
  "bookmark",
  "share",
  "podcast",
  "episode",
  "internetRadioStation",
  "nowPlaying",
  "video",
  "chatMessage",
  "lyricLine",
  "lyricsList",
  "contributor",
  "folder",
]);

export class SubsonicError extends Error {
  code: number;
  constructor(code: number, message: string) {
    super(message);
    this.code = code;
  }
}

export function xmlEscape(s: string): string {
  const amp = "\u0026";
  return s
    .replace(/&/g, `${amp}amp;`)
    .replace(/</g, `${amp}lt;`)
    .replace(/>/g, `${amp}gt;`)
    .replace(/"/g, `${amp}quot;`)
    .replace(/'/g, `${amp}apos;`);
}

function isPlainObject(v: unknown): v is Record<string, unknown> {
  return !!v && typeof v === "object" && !Array.isArray(v);
}

function xmlAttrs(obj: Record<string, unknown>): string {
  let out = "";
  for (const [k, v] of Object.entries(obj)) {
    if (v === undefined || v === null || v === "") continue;
    if (typeof v === "object") continue;
    const val = typeof v === "boolean" ? (v ? "true" : "false") : String(v);
    out += ` ${k}="${xmlEscape(val)}"`;
  }
  return out;
}

function xmlChildren(obj: Record<string, unknown>): string {
  let out = "";
  for (const [k, v] of Object.entries(obj)) {
    if (v === undefined || v === null) continue;
    if (Array.isArray(v)) {
      for (const item of v) {
        if (isPlainObject(item)) {
          const inner = xmlChildren(item);
          out += inner ? `<${k}${xmlAttrs(item)}>${inner}</${k}>` : `<${k}${xmlAttrs(item)}/>`;
        } else if (item !== undefined && item !== null && item !== "") {
          out += `<${k}>${xmlEscape(String(item))}</${k}>`;
        }
      }
    } else if (isPlainObject(v)) {
      const inner = xmlChildren(v);
      out += inner ? `<${k}${xmlAttrs(v)}>${inner}</${k}>` : `<${k}${xmlAttrs(v)}/>`;
    }
  }
  return out;
}

function stripEmpty(v: unknown): unknown {
  if (Array.isArray(v)) return v.map(stripEmpty);
  if (!isPlainObject(v)) return v;
  const out: Record<string, unknown> = {};
  for (const [k, val] of Object.entries(v)) {
    if (val === undefined || val === null || val === "") continue;
    out[k] = stripEmpty(val);
  }
  return out;
}

function forceArrays(v: unknown): unknown {
  if (Array.isArray(v)) return v.map(forceArrays);
  if (!isPlainObject(v)) return v;
  const out: Record<string, unknown> = {};
  for (const [k, val] of Object.entries(v)) {
    let n = forceArrays(val);
    if (ARRAY_KEYS.has(k)) {
      if (n === undefined || n === null) n = [];
      else if (!Array.isArray(n)) n = [n];
    }
    out[k] = n;
  }
  return out;
}

function envelope(env: Env | undefined, extra: Record<string, unknown> = {}) {
  return {
    status: extra.status ?? "ok",
    version: API_VERSION,
    type: env?.SERVER_NAME || "Relief",
    serverVersion: env?.SERVER_VERSION || "0.2.0",
    openSubsonic: true,
    ...extra,
  };
}

function send(fmt: string, body: Record<string, unknown>, jsonp?: string | null): Response {
  if (fmt === "json" || fmt === "jsonp") {
    const text = JSON.stringify({ "subsonic-response": body });
    if (fmt === "jsonp" || jsonp) {
      const cb = (jsonp || "callback").replace(/[^\w.$]/g, "");
      return new Response(`${cb}(${text});`, {
        headers: { "content-type": "application/javascript; charset=utf-8", ...cors() },
      });
    }
    return jsonResponse({ "subsonic-response": body });
  }
  const inner = xmlChildren(body);
  const xml = `<?xml version="1.0" encoding="UTF-8"?><subsonic-response xmlns="${NS}"${xmlAttrs(body)}>${inner}</subsonic-response>`;
  return new Response(xml, { headers: { "content-type": "text/xml; charset=utf-8", ...cors() } });
}

export function ok(env: Env, fmt: string, payload: Record<string, unknown> = {}, jsonp?: string | null): Response {
  const body = forceArrays(stripEmpty(envelope(env, payload))) as Record<string, unknown>;
  return send(fmt, body, jsonp);
}

export function fail(fmt: string, code: number, message: string, env?: Env, jsonp?: string | null): Response {
  const body = envelope(env, { status: "failed", error: { code, message } });
  return send(fmt, body, jsonp);
}

export function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json; charset=utf-8", ...cors() },
  });
}

export function cors(): Record<string, string> {
  return {
    "access-control-allow-origin": "*",
    "access-control-allow-methods": "GET, POST, OPTIONS",
    "access-control-allow-headers": "range, content-type, authorization, x-requested-with",
    "access-control-expose-headers": "content-length, content-range, accept-ranges",
  };
}

export function formatOf(url: URL, request?: Request): string {
  const f = (url.searchParams.get("f") || "").toLowerCase();
  if (f === "json" || f === "jsonp" || f === "xml") return f;
  const accept = request?.headers.get("accept") || "";
  if (accept.includes("application/json")) return "json";
  return "xml";
}
