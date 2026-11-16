import { ICON_COMPONENTS, ICON_NAMES, Icon } from "./Icon";

const SVG_NS = "http://www.w3.org/2000/svg";
const SHAPES = "path, circle, line, rect";

function asElement(node: Node): Element {
  expect(node.nodeType).toBe(1);
  return node as Element;
}

function shapeSignatures(root: Element): string[] {
  return Array.from(root.querySelectorAll(SHAPES)).map((shape) => shape.outerHTML);
}

describe("Icon", () => {
  it("covers every icon name with a component", () => {
    expect(Object.keys(ICON_COMPONENTS).sort()).toEqual([...ICON_NAMES].sort());
    expect(new Set(ICON_NAMES).size).toBe(ICON_NAMES.length);
  });

  it.each(ICON_NAMES)("renders %s as an svg root with svg children", (name) => {
    const root = asElement(Icon({ name }));

    expect(root.nodeName.toLowerCase()).toBe("svg");
    expect(root.namespaceURI).toBe(SVG_NS);
    expect(root.getAttribute("viewBox")).toBe("0 0 24 24");
    expect(root.getAttribute("fill")).toBe("none");
    expect(root.getAttribute("stroke")).toBe("currentColor");
    expect(root.getAttribute("stroke-width")).toBe("2");
    expect(root.getAttribute("width")).toBe("20");
    expect(root.getAttribute("height")).toBe("20");
    expect(root.getAttribute("class")).toBe("nav-item__icon");
    expect(root.getAttribute("aria-hidden")).toBe("true");

    const shapes = Array.from(root.children);
    expect(shapes.length).toBeGreaterThan(0);
    for (const shape of shapes) {
      expect(shape.namespaceURI).toBe(SVG_NS);
    }
    expect(root.querySelectorAll(SHAPES).length).toBeGreaterThan(0);
  });

  it.each(ICON_NAMES)("dispatches %s to its own component", (name) => {
    const expected = asElement(ICON_COMPONENTS[name]({}));
    const actual = asElement(Icon({ name }));

    expect(actual.nodeName).toBe(expected.nodeName);
    expect(shapeSignatures(actual)).toEqual(shapeSignatures(expected));
  });

  it("applies size and class", () => {
    const root = asElement(Icon({ name: "plus", size: 14, class: "custom-icon" }));

    expect(root.getAttribute("width")).toBe("14");
    expect(root.getAttribute("height")).toBe("14");
    expect(root.getAttribute("class")).toBe("custom-icon");
  });

  it("renders no span and no css mask or data uri", () => {
    const container = document.createElement("div");
    for (const name of ICON_NAMES) {
      container.appendChild(Icon({ name }));
    }

    expect(container.querySelectorAll("span").length).toBe(0);
    expect(container.querySelectorAll(`svg ${SHAPES}`).length).toBeGreaterThan(0);
    expect(container.innerHTML).not.toContain("mask");
    expect(container.innerHTML).not.toContain("data:image");
  });
});
