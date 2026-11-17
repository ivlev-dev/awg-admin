import { createComponent } from "@ivlev-dev/silent-core";

import { Skeleton, SkeletonCards, SkeletonTable } from "./Skeleton";

function query(root: Node, selector: string): Element | null {
  if (root instanceof Element && root.matches(selector)) return root;
  return (root as ParentNode).querySelector(selector);
}

function queryAll(root: Node, selector: string): Element[] {
  return Array.from((root as ParentNode).querySelectorAll(selector));
}

describe("Skeleton", () => {
  it("рендерит декоративный блок с заданными размерами", () => {
    const result = createComponent(Skeleton, { height: 120, width: "50%", radius: 8 });
    const node = query(result.node, ".skeleton");
    const element = node as HTMLElement | null;

    expect(node).not.toBeNull();
    expect(node?.getAttribute("aria-hidden")).toBe("true");
    expect(element?.style.height).toBe("120px");
    expect(element?.style.width).toBe("50%");
    expect(element?.style.borderRadius).toBe("8px");

    result.dispose();
  });

  it("скрыт от скринридера и не содержит текста", () => {
    const result = createComponent(Skeleton, { height: 40 });

    expect(result.node.textContent).toBe("");
    expect(query(result.node, "[aria-hidden='true']")).not.toBeNull();

    result.dispose();
  });
});

describe("SkeletonTable", () => {
  it("рисует строки и колонки таблицы", () => {
    const result = createComponent(SkeletonTable, { rows: 3, columns: 4 });
    const root = query(result.node, ".skeleton-table");

    expect(root?.getAttribute("aria-hidden")).toBe("true");
    expect(queryAll(result.node, ".skeleton-table__row")).toHaveLength(3);
    expect(queryAll(result.node, ".skeleton-table__cell")).toHaveLength(4 + 3 * 4);

    result.dispose();
  });

  it("использует значения по умолчанию", () => {
    const result = createComponent(SkeletonTable, {});

    expect(queryAll(result.node, ".skeleton-table__row")).toHaveLength(5);
    expect(queryAll(result.node, ".skeleton-table__head .skeleton-table__cell")).toHaveLength(4);

    result.dispose();
  });
});

describe("SkeletonCards", () => {
  it("рисует карточки-заглушки", () => {
    const result = createComponent(SkeletonCards, { count: 2 });
    const cards = queryAll(result.node, ".skeleton-card");

    expect(cards).toHaveLength(2);
    expect(queryAll(result.node, ".skeleton-card__line")).toHaveLength(6);
    expect(query(result.node, ".grid--4")).not.toBeNull();

    result.dispose();
  });
});
