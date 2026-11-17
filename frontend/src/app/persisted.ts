export type PersistedValidator<T> = (value: unknown) => T | null;

export interface PersistedSignalOptions {
  readonly version?: number;
}

export interface PersistedSignal<T> {
  readonly key: string;
  read(): T;
  write(value: T): void;
  clear(): void;
}

const DEFAULT_VERSION = 1;

export function persistedSignal<T>(
  key: string,
  initial: T,
  validate: PersistedValidator<T>,
  options?: PersistedSignalOptions,
): PersistedSignal<T> {
  const version = options?.version ?? DEFAULT_VERSION;
  const storageKey = `${key}.v${version}`;

  return {
    key: storageKey,
    read(): T {
      const storage = getStorage();
      if (storage === null) return initial;
      const raw = readRaw(storage, storageKey);
      if (raw === null) return initial;
      let parsed: unknown;
      try {
        parsed = JSON.parse(raw);
      } catch {
        removeRaw(storage, storageKey);
        return initial;
      }
      let value: T | null;
      try {
        value = validate(parsed);
      } catch {
        value = null;
      }
      if (value === null) {
        removeRaw(storage, storageKey);
        return initial;
      }
      return value;
    },
    write(value: T): void {
      const storage = getStorage();
      if (storage === null) return;
      try {
        storage.setItem(storageKey, JSON.stringify(value));
      } catch {
        return;
      }
    },
    clear(): void {
      const storage = getStorage();
      if (storage === null) return;
      removeRaw(storage, storageKey);
    },
  };
}

export function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

export function stringField(
  record: Record<string, unknown>,
  key: string,
  maxLength = 200,
): string | null {
  const value = record[key];
  if (typeof value !== "string") return null;
  return value.length > maxLength ? value.slice(0, maxLength) : value;
}

function getStorage(): Storage | null {
  try {
    return typeof localStorage === "undefined" ? null : localStorage;
  } catch {
    return null;
  }
}

function readRaw(storage: Storage, key: string): string | null {
  try {
    return storage.getItem(key);
  } catch {
    return null;
  }
}

function removeRaw(storage: Storage, key: string): void {
  try {
    storage.removeItem(key);
  } catch {
    return;
  }
}
