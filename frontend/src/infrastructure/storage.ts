const ACCESS_KEY = "awg.access";
const REFRESH_KEY = "awg.refresh";

export interface TokenStore {
  access(): string | null;
  refresh(): string | null;
  set(access: string, refresh: string): void;
  clear(): void;
  generation?(): number;
}

export class LocalTokenStore implements TokenStore {
  private version = 0;

  access(): string | null {
    return read(ACCESS_KEY);
  }

  refresh(): string | null {
    return read(REFRESH_KEY);
  }

  set(access: string, refresh: string): void {
    this.version += 1;
    write(ACCESS_KEY, access);
    write(REFRESH_KEY, refresh);
  }

  clear(): void {
    this.version += 1;
    remove(ACCESS_KEY);
    remove(REFRESH_KEY);
  }

  generation(): number {
    return this.version;
  }
}

export function tokenGeneration(tokens: TokenStore): number {
  return tokens.generation?.() ?? 0;
}

function memory(): Storage | null {
  try {
    return typeof localStorage === "undefined" ? null : localStorage;
  } catch {
    return null;
  }
}

function read(key: string): string | null {
  const storage = memory();
  if (storage === null) return null;
  try {
    return storage.getItem(key);
  } catch {
    return null;
  }
}

function write(key: string, value: string): void {
  const storage = memory();
  if (storage === null) return;
  try {
    storage.setItem(key, value);
  } catch {
    return;
  }
}

function remove(key: string): void {
  const storage = memory();
  if (storage === null) return;
  try {
    storage.removeItem(key);
  } catch {
    return;
  }
}
