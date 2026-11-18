import type { HttpMethod } from "./types";

export const IDEMPOTENCY_KEY_HEADER = "Idempotency-Key";

const AUTH_PATH = /^(?:\/api\/v\d+)?\/auth(?:\/|$)/;

export function createIdempotencyKey(): string {
  const randomUUID = globalThis.crypto?.randomUUID;
  if (typeof randomUUID === "function") {
    try {
      return randomUUID.call(globalThis.crypto);
    } catch {
      return fallbackUuid();
    }
  }
  return fallbackUuid();
}

export function needsIdempotencyKey(method: HttpMethod, path: string): boolean {
  return method === "POST" && !isAuthPath(path);
}

export function hasIdempotencyKey(headers: Record<string, string>): boolean {
  const target = IDEMPOTENCY_KEY_HEADER.toLowerCase();
  return Object.keys(headers).some((name) => name.toLowerCase() === target);
}

function isAuthPath(path: string): boolean {
  const pathname = path.split(/[?#]/)[0] ?? "";
  return AUTH_PATH.test(pathname);
}

function fallbackUuid(): string {
  const bytes = new Uint8Array(16);
  const getRandomValues = globalThis.crypto?.getRandomValues;
  if (typeof getRandomValues === "function") {
    getRandomValues.call(globalThis.crypto, bytes);
  } else {
    for (let index = 0; index < bytes.length; index += 1) {
      bytes[index] = Math.floor(Math.random() * 256);
    }
  }
  bytes[6] = ((bytes[6] ?? 0) & 0x0f) | 0x40;
  bytes[8] = ((bytes[8] ?? 0) & 0x3f) | 0x80;
  const hex = Array.from(bytes, (byte) => byte.toString(16).padStart(2, "0"));
  return [
    hex.slice(0, 4).join(""),
    hex.slice(4, 6).join(""),
    hex.slice(6, 8).join(""),
    hex.slice(8, 10).join(""),
    hex.slice(10, 16).join(""),
  ].join("-");
}
