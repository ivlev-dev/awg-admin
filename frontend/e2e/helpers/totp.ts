import { createHmac } from "node:crypto";

const BASE32_ALPHABET = "ABCDEFGHIJKLMNOPQRSTUVWXYZ234567";
const STEP_SECONDS = 30;
const DIGITS = 6;

function decodeBase32(value: string): Buffer {
  const clean = value.replace(/=+$/g, "").replace(/\s+/g, "").toUpperCase();
  if (clean.length === 0) throw new Error("empty TOTP secret");

  const bytes: number[] = [];
  let accumulator = 0;
  let bits = 0;
  for (const char of clean) {
    const index = BASE32_ALPHABET.indexOf(char);
    if (index < 0) throw new Error(`invalid base32 character: ${char}`);
    accumulator = (accumulator << 5) | index;
    bits += 5;
    if (bits >= 8) {
      bits -= 8;
      bytes.push((accumulator >>> bits) & 0xff);
    }
  }
  return Buffer.from(bytes);
}

export function totpCounter(timestamp = Date.now()): number {
  return Math.floor(timestamp / 1000 / STEP_SECONDS);
}

export function generateTotp(secret: string, timestamp = Date.now()): string {
  const counter = Buffer.alloc(8);
  counter.writeBigUInt64BE(BigInt(totpCounter(timestamp)));

  const digest = createHmac("sha1", decodeBase32(secret)).update(counter).digest();
  const offset = digest[digest.length - 1]! & 0x0f;
  const binary =
    ((digest[offset]! & 0x7f) << 24) |
    ((digest[offset + 1]! & 0xff) << 16) |
    ((digest[offset + 2]! & 0xff) << 8) |
    (digest[offset + 3]! & 0xff);

  return String(binary % 10 ** DIGITS).padStart(DIGITS, "0");
}

export function wrongTotp(secret: string): string {
  const current = generateTotp(secret);
  return current === "000000" ? "111111" : "000000";
}
