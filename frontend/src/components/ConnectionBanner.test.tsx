import { createComponent } from "@ivlev-dev/silent-core";

import type { ConnectionNotice } from "@/app/connection";
import { ConnectionBanner } from "./ConnectionBanner";

function textOf(node: Node): string {
  return node.textContent ?? "";
}

function find(root: Node, selector: string): Element | null {
  if (root instanceof Element && root.matches(selector)) return root;
  if (root instanceof DocumentFragment || root instanceof Element) return root.querySelector(selector);
  return null;
}

function render(notice: ConnectionNotice): DocumentFragment {
  return createComponent(
    ConnectionBanner,
    { notice: () => notice, online: () => notice !== "offline" },
    {},
  ).node as DocumentFragment;
}

describe("ConnectionBanner", () => {
  it("shows a sticky offline banner with a hint", () => {
    const node = render("offline");

    expect(textOf(node)).toContain("Нет соединения");
    expect(textOf(node)).toContain("Данные могут быть неактуальны");
    expect(find(node, ".connection-banner--offline")).not.toBeNull();
  });

  it("shows the restored banner", () => {
    const node = render("restored");

    expect(textOf(node)).toContain("Соединение восстановлено");
    expect(textOf(node)).not.toContain("Нет соединения");
    expect(find(node, ".connection-banner--restored")).not.toBeNull();
  });

  it("renders nothing without a notice", () => {
    const node = render(null);

    expect(find(node, ".connection-banner")).toBeNull();
    expect(textOf(node)).not.toContain("Нет соединения");
    expect(textOf(node)).not.toContain("Соединение восстановлено");
  });
});
