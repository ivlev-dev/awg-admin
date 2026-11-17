import { createComponent } from "@ivlev-dev/silent-core";

import { App } from "@/app/App";
import { AppVM } from "@/app/App.vm";
import { createAppContainer } from "@/app/di";

function bootingVm(): AppVM {
  return {
    booting: true,
    routeName: "overview",
    path: "/",
    showShell: false,
    connectionNotice: null,
    online: true,
    toasts: { items: [], dismiss: () => undefined },
  } as unknown as AppVM;
}

describe("App accessibility", () => {
  it("начинает документ со skip-link на main-content", async () => {
    const container = createAppContainer();
    container.bind(AppVM, () => bootingVm());

    const result = createComponent(App, {}, { container });
    await result.ready;

    const first = (result.node as ParentNode).firstElementChild;
    expect(first?.tagName).toBe("A");
    expect(first?.classList.contains("skip-link")).toBe(true);
    expect(first?.getAttribute("href")).toBe("#main-content");

    result.dispose();
  });
});
