import { createComponent } from "@ivlev-dev/silent-core";

import type { ToastItem } from "@/app/toast";
import { ToastStack } from "@/components/ToastStack";

function query(root: Node, selector: string): Element | null {
  if (root instanceof Element && root.matches(selector)) return root;
  return (root as ParentNode).querySelector(selector);
}

function queryAll(root: Node, selector: string): Element[] {
  return Array.from((root as ParentNode).querySelectorAll(selector));
}

const ITEMS: ToastItem[] = [
  { id: 1, kind: "info", message: "Информация" },
  { id: 2, kind: "success", message: "Готово" },
  { id: 3, kind: "error", message: "Ошибка" },
];

describe("ToastStack", () => {
  it("разделяет обычные и ошибочные уведомления на live-регионы", () => {
    const onDismiss = vi.fn();
    const result = createComponent(ToastStack, { items: ITEMS, onDismiss });

    const polite = query(result.node, "[role='status']");
    const assertive = query(result.node, "[role='alert']");

    expect(polite?.getAttribute("aria-live")).toBe("polite");
    expect(assertive?.getAttribute("aria-live")).toBe("assertive");

    expect(polite?.textContent).toContain("Информация");
    expect(polite?.textContent).toContain("Готово");
    expect(polite?.textContent).not.toContain("Ошибка");

    expect(assertive?.textContent).toContain("Ошибка");
    expect(assertive?.textContent).not.toContain("Информация");
    expect(queryAll(assertive as Element, ".toast--error")).toHaveLength(1);

    result.dispose();
  });

  it("закрывает уведомление кнопкой", () => {
    const onDismiss = vi.fn();
    const result = createComponent(ToastStack, { items: ITEMS, onDismiss });
    document.body.appendChild(result.node);
    const node = queryAll(result.node, ".toast").find((item) => item.textContent?.includes("Готово"));
    if (!node) throw new Error("Уведомление не найдено");
    const close = query(node, ".toast__close");
    if (!(close instanceof HTMLButtonElement)) throw new Error("Кнопка закрытия не найдена");

    expect(close.getAttribute("aria-label")).toBe("Закрыть уведомление");
    close.click();

    expect(onDismiss).toHaveBeenCalledWith(2);

    result.dispose();
    document.body.replaceChildren();
  });

  it("ставит автоскрытие на паузу при наведении и фокусе", () => {
    const onPause = vi.fn();
    const onResume = vi.fn();
    const result = createComponent(ToastStack, { items: ITEMS, onDismiss: vi.fn(), onPause, onResume });
    const node = queryAll(result.node, ".toast").find((item) => item.textContent?.includes("Готово"));
    if (!node) throw new Error("Уведомление не найдено");

    node.dispatchEvent(new MouseEvent("mouseenter", { bubbles: false }));
    node.dispatchEvent(new MouseEvent("mouseleave", { bubbles: false }));
    node.dispatchEvent(new FocusEvent("focusin", { bubbles: true }));
    node.dispatchEvent(new FocusEvent("focusout", { bubbles: true }));

    expect(onPause).toHaveBeenNthCalledWith(1, 2);
    expect(onPause).toHaveBeenNthCalledWith(2, 2);
    expect(onResume).toHaveBeenNthCalledWith(1, 2);
    expect(onResume).toHaveBeenNthCalledWith(2, 2);

    result.dispose();
  });

  it("не рендерит тосты без элементов", () => {
    const result = createComponent(ToastStack, { items: [], onDismiss: vi.fn() });

    expect(queryAll(result.node, ".toast")).toHaveLength(0);

    result.dispose();
  });
});
