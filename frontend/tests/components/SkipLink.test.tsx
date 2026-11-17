import { createComponent } from "@ivlev-dev/silent-core";

import { setLocale } from "@/i18n";
import { MAIN_CONTENT_ID, SkipLink } from "@/components/SkipLink";

function query(root: Node, selector: string): Element | null {
  if (root instanceof Element && root.matches(selector)) return root;
  return (root as ParentNode).querySelector(selector);
}

afterEach(() => {
  setLocale("ru");
});

describe("SkipLink", () => {
  it("ведёт на основное содержимое и виден только при фокусе", () => {
    const result = createComponent(SkipLink, {});
    const link = query(result.node, "a.skip-link");

    expect(link?.getAttribute("href")).toBe(`#${MAIN_CONTENT_ID}`);
    expect(MAIN_CONTENT_ID).toBe("main-content");
    expect(link?.textContent).toBe("Перейти к содержимому");

    result.dispose();
  });

  it("переводит подпись при смене языка", async () => {
    const result = createComponent(SkipLink, {});
    setLocale("en");

    await vi.waitFor(() => {
      expect(query(result.node, "a.skip-link")?.textContent).toBe("Skip to content");
    });

    result.dispose();
  });
});
