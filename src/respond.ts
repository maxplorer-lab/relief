import type { Env } from "./types";

const NS = "http://subsonic.org/restapi";
const API_VERSION = "1.16.1";

export class SubsonicError extends Error {
  code: number;
  constructor(code: number, message: string) {
    super(message);
    this.code = code;
  }
}

export function xmlEscape(s: string): string {
  return s
    .replace(/&/g, "&")
    .replace(/</g, "<")
    .replace(/>/g, ">")
    .replace(/"/g, """)
    .replace(/'/g, "'");
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
          out += inner
            ? `<${k}${xmlAttrs(item)}>${inner}</${k}>`
            : `<${k}${xmlAttrs(item)}/>`;
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

export function ok(env: Env, fmt: string, payload: Record<string, unknown> = {}): Response {
  const head = {
    status: "ok",
    version: API_VERSION,
    type: env.SERVER_NAME || "Relief",
    serverVersion: env.SERVER_VERSION || "0.1.0",
    openSubsonic: true,
  };
  const body = { ...head, ...stripEmpty(payload) } as Record<string, unknown>;
  if (fmt === "json") {
    return jsonResponse({ "subsonic-response": body });
  }
  const inner = xmlChildren(body);
  const xml = `<?xml version="1.0" encoding="UTF-8"?><subsonic-response xmlns="${NS}"${xmlAttrs(head)}>${inner}</subsonic-response>`;
  return new Response(xml, { headers: { "content-type": "text/xml; charset=utf-8", ...cors() } });
}

export function fail(fmt: string, code: number, message: string, env?: Env): Response {
  const head = {
    status: "failed",
    version: API_VERSION,
    type: env?.SERVER_NAME || "Relief",
    serverVersion: env?.SERVER_VERSION || "0.1.0",
    openSubsonic: true,
  };
  if (fmt === "json") {
    return jsonResponse({
      "subsonic-response": { ...head, error: { code, message } },
    });
  }
  const xml = `<?xml version="1.0" encoding="UTF-8"?><subsonic-response xmlns="${NS}"${xmlAttrs(head)}><error code="${code}" message="${xmlEscape(message)}"/></subsonic-response>`;
  return new Response(xml, { headers: { "content-type": "text/xml; charset=utf-8", ...cors() } });
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
    "access-control-allow-headers": "range, content-type, authorization",
    "access-control-expose-headers": "content-length, content-range, accept-ranges",
  };
}

export function formatOf(url: URL): string {
  const f = (url.searchParams.get("f") || "xml").toLowerCase();
  return f === "json" || f === "jsonp" ? "json" : "xml";
}
