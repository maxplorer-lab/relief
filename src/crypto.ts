import { createHash, randomBytes } from "node:crypto";

export function md5Hex(input: string): string {
  return createHash("md5").update(input, "utf8").digest("hex");
}

export function randomToken(bytes = 24): string {
  return randomBytes(bytes).toString("hex");
}

function b64(data: ArrayBuffer | Uint8Array): string {
  const bytes = data instanceof Uint8Array ? data : new Uint8Array(data);
  let s = "";
  for (const b of bytes) s += String.fromCharCode(b);
  return btoa(s);
}

function fromB64(s: string): Uint8Array {
  const bin = atob(s);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}

async function aesKey(secret: string): Promise<CryptoKey> {
  const hash = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(secret));
  return crypto.subtle.importKey("raw", hash, "AES-GCM", false, ["encrypt", "decrypt"]);
}

export async function encryptSecret(plain: string, secret: string): Promise<string> {
  const key = await aesKey(secret);
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const ct = await crypto.subtle.encrypt({ name: "AES-GCM", iv }, key, new TextEncoder().encode(plain));
  return `${b64(iv)}.${b64(ct)}`;
}

export async function decryptSecret(payload: string, secret: string): Promise<string> {
  const [ivB64, ctB64] = payload.split(".");
  if (!ivB64 || !ctB64) throw new Error("bad secret payload");
  const key = await aesKey(secret);
  const pt = await crypto.subtle.decrypt(
    { name: "AES-GCM", iv: fromB64(ivB64) },
    key,
    fromB64(ctB64),
  );
  return new TextDecoder().decode(pt);
}

export function decodeSubsonicPassword(p: string): string {
  if (p.startsWith("enc:")) {
    const hex = p.slice(4);
    let out = "";
    for (let i = 0; i + 1 < hex.length; i += 2) {
      out += String.fromCharCode(parseInt(hex.slice(i, i + 2), 16));
    }
    return out;
  }
  return p;
}
