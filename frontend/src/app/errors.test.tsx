import { createComponent, setErrorHandler } from "@ivlev-dev/silent-core";

import { createAppContainer } from "./di";
import { installGlobalErrorHandler } from "./errors";
import { ToastStore } from "./toast";

class BrokenVM {
  created(): void {
    throw new Error("boom");
  }
}

function BrokenView(this: { vm: BrokenVM }): Node {
  return document.createElement("div");
}

afterEach(() => {
  setErrorHandler(null);
  vi.restoreAllMocks();
});

describe("installGlobalErrorHandler", () => {
  it("reports runtime errors through the toast store and the console", async () => {
    const toasts = new ToastStore();
    const consoleError = vi.spyOn(console, "error").mockImplementation(() => undefined);
    installGlobalErrorHandler(toasts);

    const result = createComponent(BrokenView, {}, { container: createAppContainer() });
    await result.ready;

    expect(toasts.items.map((item) => item.message)).toContain(
      "Произошла ошибка интерфейса. Детали — в консоли.",
    );
    expect(consoleError).toHaveBeenCalled();

    result.dispose();
  });

  it("restores the default handler when reset", async () => {
    const toasts = new ToastStore();
    installGlobalErrorHandler(toasts);
    setErrorHandler(null);
    const consoleError = vi.spyOn(console, "error").mockImplementation(() => undefined);

    const result = createComponent(BrokenView, {}, { container: createAppContainer() });
    await result.ready;

    expect(toasts.items).toHaveLength(0);
    expect(consoleError).toHaveBeenCalled();

    result.dispose();
  });
});
