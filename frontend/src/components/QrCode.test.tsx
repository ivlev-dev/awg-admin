import { createComponent, createSignal, flushSync } from "@ivlev-dev/silent-core";
import type { ComponentResult } from "@ivlev-dev/silent-core";

import { QrCode } from "./QrCode";
import type { QrCodeProps } from "./QrCode.vm";

const mockQr = vi.hoisted(() => {
  return {
    factory: vi.fn(),
    fail: false,
    moduleCount: 3,
  };
});

vi.mock("qrcode-generator", () => ({
  default: (typeNumber: number, level: string): unknown => {
    mockQr.factory(typeNumber, level);
    if (mockQr.fail) throw new Error("qr generation failed");
    return {
      addData: (data: string): void => {
        if (data.length === 0) throw new Error("empty data");
      },
      make: (): void => undefined,
      getModuleCount: (): number => mockQr.moduleCount,
      isDark: (row: number, col: number): boolean => (row + col) % 2 === 0,
    };
  },
}));

interface MountedQr {
  result: ComponentResult;
  setValue: (value: string) => void;
  dispose: () => void;
}

function mountQr(value: string, props: Partial<Omit<QrCodeProps, "value">> = {}): MountedQr {
  const [current, setCurrent] = createSignal(value);
  const result = createComponent(QrCode, {
    get value() {
      return current();
    },
    size: props.size,
    label: props.label,
    loadingLabel: props.loadingLabel,
    errorLabel: props.errorLabel,
    limitLabel: props.limitLabel,
  });
  document.body.appendChild(result.node);
  return {
    result,
    setValue: (next: string) => {
      setCurrent(next);
      flushSync();
    },
    dispose: () => {
      result.dispose();
      result.node.parentNode?.removeChild(result.node);
    },
  };
}

function query<T extends Element>(selector: string): T | null {
  return document.querySelector<T>(selector);
}

describe("QrCode", () => {
  beforeEach(() => {
    mockQr.factory.mockClear();
    mockQr.fail = false;
    mockQr.moduleCount = 3;
  });

  afterEach(() => {
    document.body.replaceChildren();
  });

  it("лениво импортирует библиотеку и рендерит svg с aria-label", async () => {
    const mounted = mountQr("vpn://share", { label: "QR-код для ссылки", size: 200 });
    expect(mockQr.factory).not.toHaveBeenCalled();

    await mounted.result.ready;
    flushSync();
    await vi.waitFor(() => {
      expect(query(".qr-code__svg")).not.toBeNull();
    });

    expect(mockQr.factory).toHaveBeenCalledTimes(1);
    expect(mockQr.factory).toHaveBeenCalledWith(0, "M");

    const svg = query<SVGSVGElement>(".qr-code__svg");
    if (svg === null) throw new Error("svg not rendered");
    expect(svg.getAttribute("role")).toBe("img");
    expect(svg.getAttribute("aria-label")).toBe("QR-код для ссылки");
    expect(svg.getAttribute("viewBox")).toBe("0 0 7 7");
    expect(svg.getAttribute("width")).toBe("200");
    expect(svg.getAttribute("height")).toBe("200");
    expect(svg.getAttribute("shape-rendering")).toBe("crispEdges");

    const background = svg.querySelector("rect");
    expect(background?.getAttribute("fill")).toBe("#ffffff");
    expect(background?.getAttribute("width")).toBe("7");

    const path = svg.querySelector("path");
    expect(path?.getAttribute("fill")).toBe("#000000");
    expect(path?.getAttribute("d")?.startsWith("M2 2h1v1h-1z")).toBe(true);

    mounted.dispose();
  });

  it("показывает skeleton, пока библиотека загружается", async () => {
    const mounted = mountQr("vpn://share", { loadingLabel: "Готовим QR" });
    await mounted.result.ready;
    flushSync();

    const placeholder = query<HTMLElement>(".qr-code__placeholder");
    expect(placeholder).not.toBeNull();
    expect(placeholder?.getAttribute("role")).toBe("status");
    expect(placeholder?.getAttribute("aria-label")).toBe("Готовим QR");

    await vi.waitFor(() => {
      expect(query(".qr-code__svg")).not.toBeNull();
    });
    mounted.dispose();
  });

  it("показывает ошибку генерации", async () => {
    mockQr.fail = true;
    const mounted = mountQr("vpn://share", { errorLabel: "QR недоступен" });

    await mounted.result.ready;
    flushSync();
    await vi.waitFor(() => {
      expect(query(".qr-code__error")?.textContent).toBe("QR недоступен");
    });
    expect(query(".qr-code__error")?.getAttribute("role")).toBe("alert");
    expect(query(".qr-code__svg")).toBeNull();
    mounted.dispose();
  });

  it("ограничивает длину значения и не загружает библиотеку", async () => {
    const mounted = mountQr("x".repeat(1901), { limitLabel: "Слишком длинная ссылка" });

    await mounted.result.ready;
    flushSync();

    expect(query(".qr-code__error")?.textContent).toBe("Слишком длинная ссылка");
    expect(mockQr.factory).not.toHaveBeenCalled();
    mounted.dispose();
  });

  it("перегенерирует QR при изменении значения", async () => {
    const mounted = mountQr("vpn://one");
    await mounted.result.ready;
    flushSync();
    await vi.waitFor(() => {
      expect(query(".qr-code__svg")).not.toBeNull();
    });

    mounted.setValue("vpn://two");
    await vi.waitFor(() => {
      expect(mockQr.factory).toHaveBeenCalledTimes(2);
    });
    expect(query(".qr-code__svg")?.getAttribute("aria-label")).toBe("QR-код");
    mounted.dispose();
  });

  it("зажимает размер в допустимых границах", async () => {
    const small = mountQr("vpn://share", { size: 20 });
    const large = mountQr("vpn://share", { size: 900 });
    await Promise.all([small.result.ready, large.result.ready]);
    flushSync();
    await vi.waitFor(() => {
      expect(document.querySelectorAll(".qr-code__svg")).toHaveLength(2);
    });

    const svgs = Array.from(document.querySelectorAll<SVGSVGElement>(".qr-code__svg"));
    expect(svgs.map((svg) => svg.getAttribute("width"))).toEqual(["96", "512"]);
    small.dispose();
    large.dispose();
  });

  it("показывает ошибку для пустого значения", async () => {
    const mounted = mountQr("  ", { errorLabel: "Нет данных" });
    await mounted.result.ready;
    flushSync();

    expect(query(".qr-code__error")?.textContent).toBe("Нет данных");
    expect(mockQr.factory).not.toHaveBeenCalled();
    mounted.dispose();
  });
});
