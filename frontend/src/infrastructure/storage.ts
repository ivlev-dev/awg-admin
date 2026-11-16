const ACCESS_KEY = "awg.access";
const REFRESH_KEY = "awg.refresh";

export type TokenStore = {
  access(): string | null;
  refresh(): string | null;
  set(access: string, refresh: string): void;
  clear(): void;
};

export class LocalTokenStore implements TokenStore {
  access(): string | null {
    return localStorage.getItem(ACCESS_KEY);
  }

  refresh(): string | null {
    return localStorage.getItem(REFRESH_KEY);
  }

  set(access: string, refresh: string): void {
    localStorage.setItem(ACCESS_KEY, access);
    localStorage.setItem(REFRESH_KEY, refresh);
  }

  clear(): void {
    localStorage.removeItem(ACCESS_KEY);
    localStorage.removeItem(REFRESH_KEY);
  }
}

