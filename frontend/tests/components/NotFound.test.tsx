import { createComponent } from "@ivlev-dev/silent-core";

import { NotFound } from "@/components/NotFound";

function textOf(node: Node): string {
  return node.textContent ?? "";
}

function find(root: Node, selector: string): Element | null {
  if (root instanceof Element && root.matches(selector)) return root;
  return (root as ParentNode).querySelector(selector);
}

afterEach(() => {
  document.body.replaceChildren();
});

describe("NotFound", () => {
  it("renders the missing section message with the requested path", () => {
    const result = createComponent(NotFound, {
      path: "/missing/page",
      onHome: vi.fn(),
      standalone: true,
    });

    expect(textOf(result.node)).toContain("404");
    expect(textOf(result.node)).toContain("Раздел не найден");
    expect(textOf(result.node)).toContain("/missing/page");
    expect(find(result.node, ".state-screen--standalone")).not.toBeNull();

    result.dispose();
  });

  it("navigates home instead of reloading the anchor", () => {
    const onHome = vi.fn();
    const result = createComponent(NotFound, { path: "/missing", onHome });
    document.body.appendChild(result.node);
    const link = find(result.node, "a");
    if (!link) throw new Error("Ссылка на обзор не найдена");

    const event = new MouseEvent("click", { bubbles: true, cancelable: true });
    link.dispatchEvent(event);

    expect(event.defaultPrevented).toBe(true);
    expect(onHome).toHaveBeenCalledTimes(1);

    result.dispose();
  });
});
