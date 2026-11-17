import { reactive } from "@ivlev-dev/silent-core";

export type ThemeMode = "system" | "light" | "dark";

const KEY = "awg.theme";

export class ThemeStore {
  @reactive accessor mode: ThemeMode = readMode();

  constructor() {
    this.apply();
    window.matchMedia("(prefers-color-scheme: dark)").addEventListener("change", () => {
      if (this.mode === "system") this.apply();
    });
  }

  set(mode: ThemeMode): void {
    this.mode = mode;
    localStorage.setItem(KEY, mode);
    this.apply();
  }

  toggle(): void {
    this.set(this.effective === "dark" ? "light" : "dark");
  }

  get effective(): "light" | "dark" {
    if (this.mode === "system") {
      return window.matchMedia("(prefers-color-scheme: dark)").matches ? "dark" : "light";
    }
    return this.mode;
  }

  private apply(): void {
    const root = document.documentElement;
    if (this.mode === "system") {
      root.removeAttribute("data-theme");
    } else {
      root.setAttribute("data-theme", this.mode);
    }
    const meta = document.querySelector('meta[name="theme-color"]');
    if (meta) {
      meta.setAttribute("content", this.effective === "dark" ? "#060c15" : "#f2f5f9");
    }
  }
}

function readMode(): ThemeMode {
  const value = localStorage.getItem(KEY);
  return value === "light" || value === "dark" ? value : "system";
}
