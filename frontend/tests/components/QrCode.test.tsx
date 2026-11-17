import { createComponent, createSignal, flushSync } from "@ivlev-dev/silent-core";
import type { ComponentResult } from "@ivlev-dev/silent-core";

import { QrCode } from "@/components/QrCode";
import type { QrCodeProps } from "@/components/QrCode.vm";

function mountQr(value: string, props: Partial<Omit<QrCodeProps, "value">> = {}) {
  const [current, setCurrent] = createSignal(value);
  const result: ComponentResult = createComponent(QrCode, {
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

function visible<T extends Element>(selector: string): T | null {
  return document.querySelector<T>(`${selector}:not(.hidden)`);
}

async function waitForSvg(): Promise<void> {
  await vi.waitFor(() => {
    expect(visible(".qr-code__svg")).not.toBeNull();
  });
}

describe("QrCode", () => {
  afterEach(() => {
    document.body.replaceChildren();
  });

  it("рендерит svg с aria-label и crispEdges", async () => {
    const mounted = mountQr("vpn://share", { label: "QR-код для ссылки", size: 200 });
    await mounted.result.ready;
    await waitForSvg();

    const svg = visible<SVGSVGElement>(".qr-code__svg");
    if (svg === null) throw new Error("svg not rendered");
    expect(svg.getAttribute("role")).toBe("img");
    expect(svg.getAttribute("aria-label")).toBe("QR-код для ссылки");
    expect(svg.getAttribute("width")).toBe("200");
    expect(svg.getAttribute("height")).toBe("200");
    expect(svg.getAttribute("shape-rendering")).toBe("crispEdges");
    expect(svg.getAttribute("viewBox")).toMatch(/^0 0 \d+ \d+$/);
    expect(svg.querySelector("rect")?.getAttribute("fill")).toBe("#ffffff");
    expect(svg.querySelector("path")?.getAttribute("d")?.length).toBeGreaterThan(0);
    expect(visible('[role="status"]')).toBeNull();
    mounted.dispose();
  });

  it("показывает спиннер во время асинхронной загрузки и не оставляет пустой экран", async () => {
    const mounted = mountQr("vpn://share", { loadingLabel: "Считаем QR-код" });
    await mounted.result.ready;
    await waitForSvg();
    expect(document.querySelector(".qr-code")?.children.length).toBeGreaterThan(0);

    mounted.setValue("vpn://another");

    const placeholder = visible<HTMLElement>('[role="status"]');
    expect(placeholder).not.toBeNull();
    expect(placeholder?.getAttribute("aria-label")).toBe("Считаем QR-код");
    expect(placeholder?.querySelector(".spinner")).not.toBeNull();
    expect(visible(".qr-code__svg")).toBeNull();

    await waitForSvg();
    expect(visible('[role="status"]')).toBeNull();
    mounted.dispose();
  });

  it("переходит idle → loading → ready → error", async () => {
    const mounted = mountQr("vpn://share", { errorLabel: "Нет данных" });
    await mounted.result.ready;

    expect(document.querySelectorAll(".qr-code")).toHaveLength(1);
    expect(visible('[role="status"]') ?? visible(".qr-code__svg")).not.toBeNull();
    await waitForSvg();

    mounted.setValue("vpn://another");
    expect(visible('[role="status"]')).not.toBeNull();
    expect(visible(".qr-code__svg")).toBeNull();
    await waitForSvg();

    mounted.setValue("   ");
    await vi.waitFor(() => {
      expect(visible(".qr-code__error")?.textContent).toBe("Нет данных");
    });
    expect(visible(".qr-code__error")?.getAttribute("role")).toBe("alert");
    expect(visible(".qr-code__svg")).toBeNull();
    expect(visible('[role="status"]')).toBeNull();
    mounted.dispose();
  });

  it("ограничивает длину значения", async () => {
    const mounted = mountQr("x".repeat(1901), { limitLabel: "Слишком длинная ссылка" });
    await mounted.result.ready;
    await vi.waitFor(() => {
      expect(visible(".qr-code__error")?.textContent).toBe("Слишком длинная ссылка");
    });
    expect(visible(".qr-code__svg")).toBeNull();
    expect(visible('[role="status"]')).toBeNull();
    mounted.dispose();
  });

  it("переходит из готового состояния в limit", async () => {
    const mounted = mountQr("vpn://share", { limitLabel: "Лимит превышен" });
    await mounted.result.ready;
    await waitForSvg();

    mounted.setValue("y".repeat(1901));
    await vi.waitFor(() => {
      expect(visible(".qr-code__error")?.textContent).toBe("Лимит превышен");
    });
    expect(visible(".qr-code__svg")).toBeNull();
    mounted.dispose();
  });

  it("показывает ошибку для пустого значения", async () => {
    const mounted = mountQr("  ", { errorLabel: "Нет данных" });
    await mounted.result.ready;
    await vi.waitFor(() => {
      expect(visible(".qr-code__error")?.textContent).toBe("Нет данных");
    });
    expect(visible(".qr-code__svg")).toBeNull();
    mounted.dispose();
  });

  it("зажимает размер в допустимых границах", async () => {
    const small = mountQr("vpn://share", { size: 20 });
    const large = mountQr("vpn://share", { size: 900 });
    await Promise.all([small.result.ready, large.result.ready]);
    await vi.waitFor(() => {
      expect(document.querySelectorAll(".qr-code__svg:not(.hidden)")).toHaveLength(2);
    });
    const widths = Array.from(document.querySelectorAll<SVGSVGElement>(".qr-code__svg")).map((svg) =>
      svg.getAttribute("width"),
    );
    expect(widths).toEqual(["96", "512"]);
    small.dispose();
    large.dispose();
  });
});
