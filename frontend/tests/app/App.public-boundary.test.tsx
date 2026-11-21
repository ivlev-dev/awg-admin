import { createComponent } from "@ivlev-dev/silent-core";
import { Router as SilentRouter, createTestRouter } from "@ivlev-dev/silent-router";

import { App } from "@/app/App";
import { AppVM } from "@/app/App.vm";
import { createAppContainer } from "@/app/di";

function Broken(): Node {
  throw new Error("public render failed");
}

function fakeVm(go: (path: string) => void): AppVM {
  return {
    booting: false,
    showPublic: true,
    showShell: false,
    path: "/login",
    title: "Вход",
    connectionNotice: null,
    online: true,
    toasts: {
      items: [],
      dismiss: () => undefined,
      pause: () => undefined,
      resume: () => undefined,
    },
    go,
  } as unknown as AppVM;
}

describe("App public error boundary", () => {
  beforeEach(() => {
    vi.spyOn(console, "error").mockImplementation(() => undefined);
  });

  afterEach(() => {
    document.body.replaceChildren();
    vi.restoreAllMocks();
  });

  it("shows the fallback instead of a blank screen when a public page fails", async () => {
    const container = createAppContainer();
    const go = vi.fn();
    const router = createTestRouter({
      routes: [{ path: "/login", name: "login", component: Broken }],
      initial: "/login",
    });
    await router.start().catch(() => undefined);
    container.bindValue(SilentRouter, router);
    container.bindValue(AppVM, fakeVm(go));

    const result = createComponent(App, {}, { container });
    await result.ready;

    const text = (result.node as Node).textContent ?? "";
    expect(text).toContain("Что-то пошло не так");
    expect(text).toContain("public render failed");

    const home = Array.from(
      (result.node as ParentNode).querySelectorAll<HTMLButtonElement>("button"),
    ).find((button) => button.textContent?.trim() === "На главную");
    expect(home).toBeDefined();
    document.body.appendChild(result.node);
    home?.click();
    expect(go).toHaveBeenCalledWith("/login");

    result.dispose();
    router.dispose();
    container.dispose();
  });
});
