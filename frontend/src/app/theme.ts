import { reactive } from "@ivlev-dev/silent-core";

export type ThemeMode = "system" | "light" | "dark";

const KEY = "awg.theme";

const THEME_COLORS: Record<"light" | "dark", string> = {
  light: "#f2f5f9",
  dark: "#060c15",
};

function prefersDark(): boolean {
  try {
    return window.matchMedia("(prefers-color-scheme: dark)").matches;
  } catch {
    return false;
  }
}

export class ThemeStore {
  @reactive accessor mode: ThemeMode = readMode();

  constructor() {
    this.apply();
    const query = window.matchMedia("(prefers-color-scheme: dark)");
    if (typeof query.addEventListener === "function") {
      query.addEventListener("change", () => {
        if (this.mode === "system") this.apply();
      });
    }
  }

  set(mode: ThemeMode): void {
    this.mode = mode;
    try {
      localStorage.setItem(KEY, mode);
    } catch {
      // Хранилище недоступно (Safari private mode, iframe) — тема живёт до перезагрузки.
    }
    this.apply();
  }

  toggle(): void {
    this.set(this.effective === "dark" ? "light" : "dark");
  }

  get effective(): "light" | "dark" {
    if (this.mode === "system") return prefersDark() ? "dark" : "light";
    return this.mode;
  }

  private apply(): void {
    const effective = this.effective;
    const root = document.documentElement;
    root.setAttribute("data-theme", effective);
    root.style.colorScheme = effective;
    const meta = document.querySelector('meta[name="theme-color"]');
    if (meta) meta.setAttribute("content", THEME_COLORS[effective]);
  }
}

function readMode(): ThemeMode {
  try {
    const value = localStorage.getItem(KEY);
    return value === "light" || value === "dark" ? value : "system";
  } catch {
    return "system";
  }
}
