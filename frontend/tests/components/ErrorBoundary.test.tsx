import { createComponent } from "@ivlev-dev/silent-core";

import { createAppContainer } from "@/app/di";
import { AppErrorBoundary } from "@/components/ErrorBoundary";

beforeEach(() => {
  vi.spyOn(console, "error").mockImplementation(() => undefined);
});

afterEach(() => {
  document.body.replaceChildren();
  vi.restoreAllMocks();
});

function Broken(): Node {
  throw new Error("render failed");
}

function textOf(node: Node): string {
  return node.textContent ?? "";
}

function buttonByText(root: Node, label: string): HTMLButtonElement {
  const buttons = Array.from((root as DocumentFragment).querySelectorAll<HTMLButtonElement>("button"));
  const found = buttons.find((button) => button.textContent?.trim() === label);
  if (!found) throw new Error(`Кнопка «${label}» не найдена`);
  return found;
}

describe("AppErrorBoundary", () => {
  it("renders the fallback with a reload and a home action", async () => {
    const onHome = vi.fn();
    const result = createComponent(
      AppErrorBoundary,
      { onHome, children: () => <Broken /> },
      { container: createAppContainer() },
    );
    await result.ready;

    expect(textOf(result.node)).toContain("Что-то пошло не так");
    expect(textOf(result.node)).toContain("render failed");
    expect(buttonByText(result.node, "Обновить страницу")).toBeDefined();
    const home = buttonByText(result.node, "На главную");
    document.body.appendChild(result.node);

    home.click();

    expect(onHome).toHaveBeenCalledTimes(1);


    result.dispose();
  });

  it("keeps working children untouched", async () => {
    const onHome = vi.fn();
    const result = createComponent(
      AppErrorBoundary,
      { onHome, children: () => <div class="safe">safe content</div> },
      { container: createAppContainer() },
    );
    await result.ready;

    expect(textOf(result.node)).toContain("safe content");
    expect(textOf(result.node)).not.toContain("Что-то пошло не так");

    result.dispose();
  });
});
