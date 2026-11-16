import { AreaChart, Sparkline } from "./Charts";

const SVG_NS = "http://www.w3.org/2000/svg";

function asElement(node: Node): Element {
  expect(node.nodeType).toBe(1);
  return node as Element;
}

describe("Sparkline", () => {
  it("renders an svg with namespaced paths", () => {
    const root = asElement(Sparkline({ values: [1, 4, 2, 6], width: 160, height: 44, fill: true }));

    expect(root.nodeName.toLowerCase()).toBe("svg");
    expect(root.namespaceURI).toBe(SVG_NS);
    expect(root.getAttribute("viewBox")).toBe("0 0 160 44");
    expect(root.getAttribute("aria-hidden")).toBe("true");

    const paths = Array.from(root.querySelectorAll("path"));
    expect(paths.length).toBe(2);
    for (const path of paths) {
      expect(path.namespaceURI).toBe(SVG_NS);
    }

    const line = paths[0];
    expect(line?.getAttribute("stroke-width")).toBe("1.8");
    expect(line?.getAttribute("stroke-linecap")).toBe("round");
    expect(line?.getAttribute("stroke-linejoin")).toBe("round");
    expect(line?.getAttribute("d")).toMatch(/^M/);

    const area = paths[1];
    expect(area?.getAttribute("opacity")).toBe("0.14");
    expect(area?.getAttribute("d")).toContain("Z");
  });

  it("omits the area when fill is disabled", () => {
    const root = asElement(Sparkline({ values: [1, 2, 3] }));
    const paths = Array.from(root.querySelectorAll("path"));

    expect(paths.length).toBe(2);
    expect(paths[1]?.getAttribute("d")).toBe("");
  });

  it("does not use data uris", () => {
    const root = asElement(Sparkline({ values: [3, 1, 2], fill: true }));

    expect(root.outerHTML).not.toContain("data:image");
    expect(root.outerHTML).not.toContain("mask");
  });
});

describe("AreaChart", () => {
  const data = [
    { at: 0, rx: 10, tx: 5 },
    { at: 1, rx: 20, tx: 8 },
    { at: 2, rx: 15, tx: 12 },
  ];

  it("renders a namespaced svg with grid and series", () => {
    const root = asElement(AreaChart({ data, height: 180 }));
    const svg = root.querySelector("svg");

    expect(root.getAttribute("role")).toBe("img");
    expect(root.getAttribute("aria-label")).toBe("График трафика");
    expect(svg).not.toBeNull();
    expect(svg?.namespaceURI).toBe(SVG_NS);
    expect(svg?.getAttribute("viewBox")).toBe("0 0 720 180");
    expect(svg?.getAttribute("preserveAspectRatio")).toBe("none");

    const lines = Array.from(svg?.querySelectorAll("line") ?? []);
    expect(lines.length).toBe(3);
    for (const line of lines) {
      expect(line.namespaceURI).toBe(SVG_NS);
      expect(line.getAttribute("stroke-width")).toBe("1");
    }

    const paths = Array.from(svg?.querySelectorAll("path") ?? []);
    expect(paths.length).toBe(3);
    for (const path of paths) {
      expect(path.namespaceURI).toBe(SVG_NS);
    }
    expect(paths[0]?.getAttribute("opacity")).toBe("0.16");
    expect(paths[1]?.getAttribute("stroke")).toBe("var(--accent)");
    expect(paths[1]?.getAttribute("stroke-width")).toBe("2.2");
    expect(paths[2]?.getAttribute("stroke")).toBe("var(--brand-3)");
  });

  it("hides tx series on request", () => {
    const svg = asElement(AreaChart({ data, showTx: false })).querySelector("svg");
    const paths = Array.from(svg?.querySelectorAll("path") ?? []);

    expect(paths[1]?.getAttribute("d")).toMatch(/^M/);
    expect(paths[2]?.getAttribute("d")).toBe("");
  });

  it("does not use data uris", () => {
    const root = asElement(AreaChart({ data }));

    expect(root.outerHTML).not.toContain("data:image");
    expect(root.outerHTML).not.toContain("mask");
  });
});
