export type ParsedTags = {
  title?: string;
  artist?: string;
  album?: string;
  track?: number;
  disc?: number;
  year?: number;
  genre?: string;
  duration?: number;
  sampleRate?: number;
  bitDepth?: number;
  cover?: { mime: string; bytes: Uint8Array };
};

function latin1(bytes: Uint8Array, start: number, end: number): string {
  let s = "";
  for (let i = start; i < end && i < bytes.length; i++) s += String.fromCharCode(bytes[i]);
  return s;
}

function decodeId3Text(bytes: Uint8Array): string {
  if (!bytes.length) return "";
  const enc = bytes[0];
  const body = bytes.subarray(1);
  try {
    if (enc === 0) return new TextDecoder("latin1").decode(body).replace(/\0/g, "").trim();
    if (enc === 1 || enc === 2) return new TextDecoder("utf-16").decode(body).replace(/\0/g, "").trim();
    return new TextDecoder("utf-8").decode(body).replace(/\0/g, "").trim();
  } catch {
    return latin1(body, 0, body.length).replace(/\0/g, "").trim();
  }
}

function synchsafe(b: Uint8Array, i: number): number {
  return ((b[i] & 0x7f) << 21) | ((b[i + 1] & 0x7f) << 14) | ((b[i + 2] & 0x7f) << 7) | (b[i + 3] & 0x7f);
}

function parseId3(bytes: Uint8Array, tags: ParsedTags): void {
  if (latin1(bytes, 0, 3) !== "ID3") return;
  const size = synchsafe(bytes, 6);
  let i = 10;
  const end = Math.min(bytes.length, 10 + size);
  while (i + 10 < end) {
    const id = latin1(bytes, i, i + 4);
    if (!id.trim() || id[0] === "\0") break;
    const len = (bytes[i + 4] << 24) | (bytes[i + 5] << 16) | (bytes[i + 6] << 8) | bytes[i + 7];
    if (len <= 0 || i + 10 + len > bytes.length) break;
    const data = bytes.subarray(i + 10, i + 10 + len);
    if (id === "TIT2") tags.title = decodeId3Text(data);
    else if (id === "TPE1") tags.artist = decodeId3Text(data);
    else if (id === "TALB") tags.album = decodeId3Text(data);
    else if (id === "TCON") tags.genre = decodeId3Text(data).replace(/^\(\d+\)/, "").trim();
    else if (id === "TRCK") tags.track = parseInt(decodeId3Text(data), 10) || undefined;
    else if (id === "TPOS") tags.disc = parseInt(decodeId3Text(data), 10) || undefined;
    else if (id === "TYER" || id === "TDRC") tags.year = parseInt(decodeId3Text(data), 10) || undefined;
    else if (id === "APIC") {
      let p = 1;
      while (p < data.length && data[p] !== 0) p++;
      const mime = new TextDecoder().decode(data.subarray(1, p)) || "image/jpeg";
      p += 2;
      while (p < data.length && data[p] !== 0) p++;
      p += 1;
      tags.cover = { mime, bytes: data.subarray(p) };
    }
    i += 10 + len;
  }
}

function readFlacBlock(bytes: Uint8Array, offset: number) {
  const isLast = (bytes[offset] & 0x80) !== 0;
  const type = bytes[offset] & 0x7f;
  const size = (bytes[offset + 1] << 16) | (bytes[offset + 2] << 8) | bytes[offset + 3];
  return { isLast, type, size, data: bytes.subarray(offset + 4, offset + 4 + size), next: offset + 4 + size };
}

function parseVorbisComment(data: Uint8Array, tags: ParsedTags): void {
  const view = new DataView(data.buffer, data.byteOffset, data.byteLength);
  if (data.length < 8) return;
  const vendorLen = view.getUint32(0, true);
  let o = 4 + vendorLen;
  if (o + 4 > data.length) return;
  const count = view.getUint32(o, true);
  o += 4;
  const set = (k: string, v: string) => {
    const key = k.toUpperCase();
    if (key === "TITLE") tags.title = v;
    else if (key === "ARTIST" || key === "ALBUMARTIST") tags.artist = tags.artist || v;
    else if (key === "ALBUM") tags.album = v;
    else if (key === "TRACKNUMBER") tags.track = parseInt(v, 10) || undefined;
    else if (key === "DISCNUMBER") tags.disc = parseInt(v, 10) || undefined;
    else if (key === "DATE" || key === "YEAR") tags.year = parseInt(v, 10) || undefined;
    else if (key === "GENRE") tags.genre = v;
  };
  for (let n = 0; n < count && o + 4 <= data.length; n++) {
    const len = view.getUint32(o, true);
    o += 4;
    const s = new TextDecoder().decode(data.subarray(o, o + len));
    o += len;
    const eq = s.indexOf("=");
    if (eq > 0) set(s.slice(0, eq), s.slice(eq + 1));
  }
}

function parseFlacPicture(data: Uint8Array, tags: ParsedTags): void {
  const view = new DataView(data.buffer, data.byteOffset, data.byteLength);
  if (data.length < 16) return;
  let o = 4;
  const mimeLen = view.getUint32(o);
  o += 4;
  const mime = new TextDecoder().decode(data.subarray(o, o + mimeLen)) || "image/jpeg";
  o += mimeLen;
  const descLen = view.getUint32(o);
  o += 4 + descLen + 16;
  const picLen = view.getUint32(o);
  o += 4;
  tags.cover = { mime, bytes: data.subarray(o, o + picLen) };
}

function parseFlac(bytes: Uint8Array, tags: ParsedTags): void {
  if (latin1(bytes, 0, 4) !== "fLaC") return;
  let o = 4;
  for (let n = 0; n < 16 && o + 4 < bytes.length; n++) {
    const block = readFlacBlock(bytes, o);
    if (block.type === 0 && block.data.length >= 18) {
      const sr = ((block.data[10] << 12) | (block.data[11] << 4) | (block.data[12] >> 4)) >>> 0;
      const bps = ((block.data[12] & 0x0f) << 1) | (block.data[13] >> 7);
      const total =
        ((block.data[13] & 0x0f) * 2 ** 32 +
          (block.data[14] << 24) +
          (block.data[15] << 16) +
          (block.data[16] << 8) +
          block.data[17]) >>>
        0;
      tags.sampleRate = sr;
      tags.bitDepth = bps + 1;
      if (sr) tags.duration = Math.round(total / sr);
    } else if (block.type === 4) parseVorbisComment(block.data, tags);
    else if (block.type === 6 && !tags.cover) parseFlacPicture(block.data, tags);
    o = block.next;
    if (block.isLast) break;
  }
}

export function parseTags(bytes: Uint8Array): ParsedTags {
  const tags: ParsedTags = {};
  if (bytes.length >= 10 && latin1(bytes, 0, 3) === "ID3") parseId3(bytes, tags);
  else if (bytes.length >= 8 && latin1(bytes, 0, 4) === "fLaC") parseFlac(bytes, tags);
  return tags;
}

export function guessFromFilename(name: string): ParsedTags {
  const base = name.replace(/\.[^.]+$/, "").replace(/_/g, " ");
  const parts = base.split(" - ").map((s) => s.trim());
  if (parts.length >= 3) {
    const track = parseInt(parts[2], 10);
    return {
      artist: parts[0],
      album: parts[1],
      title: parts[2].replace(/^\d+\s*/, ""),
      track: Number.isFinite(track) ? track : undefined,
    };
  }
  if (parts.length === 2) return { artist: parts[0], title: parts[1] };
  return { title: base };
}
