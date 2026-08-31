export const FOLDER_ID = "mf-1";

export function artistId(n: number): string {
  return `ar-${n}`;
}
export function albumId(n: number): string {
  return `al-${n}`;
}
export function trackId(n: number): string {
  return `tr-${n}`;
}
export function playlistId(n: number): string {
  return `pl-${n}`;
}

export function parseId(raw: string | null | undefined): { kind: string; n: number } | null {
  if (!raw) return null;
  const m = /^(ar|al|tr|pl|mf|cv)-(\d+)$/.exec(raw);
  if (!m) {
    const n = Number(raw);
    if (Number.isInteger(n) && n > 0) return { kind: "tr", n };
    return null;
  }
  return { kind: m[1], n: Number(m[2]) };
}

export function iso(ms: number | null | undefined): string | undefined {
  if (!ms) return undefined;
  return new Date(ms).toISOString();
}

export function now(): number {
  return Date.now();
}

export function contentTypeFor(suffix: string): string {
  const s = suffix.toLowerCase().replace(/^\./, "");
  if (s === "flac") return "audio/flac";
  if (s === "mp3") return "audio/mpeg";
  if (s === "jpg" || s === "jpeg") return "image/jpeg";
  if (s === "png") return "image/png";
  if (s === "webp") return "image/webp";
  return "application/octet-stream";
}

export function suffixOf(filename: string): string {
  const i = filename.lastIndexOf(".");
  return i >= 0 ? filename.slice(i + 1).toLowerCase() : "";
}

export function safeSegment(s: string): string {
  return s
    .replace(/[<>:"/\\|?*\u0000-\u001f]/g, "")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 120) || "unknown";
}
