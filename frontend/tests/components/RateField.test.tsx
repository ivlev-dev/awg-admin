import { createComponent, createSignal, flushSync } from "@ivlev-dev/silent-core";

import { RateField } from "@/components/RateField";

interface MountOptions {
  value?: number;
  hint?: string;
  min?: number;
  max?: number;
  disabled?: boolean;
}

interface MountedRateField {
  input: HTMLInputElement;
  select: HTMLSelectElement;
  onChange: ReturnType<typeof vi.fn>;
  setValue: (value: number) => void;
  dispose: () => void;
}

function mount(options: MountOptions = {}): MountedRateField {
  const [value, setValue] = createSignal(options.value ?? 0);
  const onChange = vi.fn((kbps: number) => setValue(kbps));
  const result = createComponent(RateField, {
    id: "rate",
    label: "Скорость",
    get value() {
      return value();
    },
    onChange,
    hint: options.hint,
    min: options.min,
    max: options.max,
    disabled: options.disabled,
  });
  document.body.appendChild(result.node);
  flushSync();
  const input = document.querySelector<HTMLInputElement>("#rate");
  const select = document.querySelector<HTMLSelectElement>(".rate-field__unit");
  if (input === null || select === null) throw new Error("rate field is not rendered");
  return { input, select, onChange, setValue, dispose: result.dispose };
}

function type(input: HTMLInputElement, text: string): void {
  input.value = text;
  input.dispatchEvent(new Event("input", { bubbles: true }));
  flushSync();
}

function chooseUnit(select: HTMLSelectElement, unit: string): void {
  select.value = unit;
  select.dispatchEvent(new Event("change", { bubbles: true }));
  flushSync();
}

afterEach(() => {
  document.body.replaceChildren();
});

describe("RateField", () => {
  it("показывает значение в Мбит/с и отправляет Кбит/с", () => {
    const field = mount({ value: 10000, hint: "0 — без лимита" });

    expect(field.input.value).toBe("10");
    expect(field.input.getAttribute("type")).toBe("text");
    expect(field.input.getAttribute("inputmode")).toBe("decimal");
    expect(field.select.value).toBe("mbps");
    expect(document.body.textContent).toContain("0 — без лимита");

    type(field.input, "1.5");

    expect(field.onChange).toHaveBeenLastCalledWith(1500);
    expect(field.input.value).toBe("1.5");

    field.dispose();
  });

  it("принимает запятую и округляет до целых Кбит/с", () => {
    const field = mount();

    type(field.input, "1,5");
    expect(field.onChange).toHaveBeenLastCalledWith(1500);

    type(field.input, "0,0015");
    expect(field.onChange).toHaveBeenLastCalledWith(2);

    field.dispose();
  });

  it("превращает пустое и отрицательное значение в ноль", () => {
    const field = mount({ value: 500 });

    type(field.input, "");
    expect(field.onChange).toHaveBeenLastCalledWith(0);

    type(field.input, "-7");
    expect(field.onChange).toHaveBeenLastCalledWith(0);

    field.dispose();
  });

  it("ограничивает значение рамками min и max", () => {
    const field = mount({ min: 100, max: 20000 });

    type(field.input, "0.01");
    expect(field.onChange).toHaveBeenLastCalledWith(100);

    type(field.input, "50");
    expect(field.onChange).toHaveBeenLastCalledWith(20000);

    field.dispose();
  });

  it("переключает единицы без изменения скорости", () => {
    const field = mount({ value: 1500 });
    expect(field.input.value).toBe("1.5");

    chooseUnit(field.select, "kbps");

    expect(field.input.value).toBe("1500");
    expect(field.onChange).toHaveBeenLastCalledWith(1500);

    type(field.input, "250");
    expect(field.onChange).toHaveBeenLastCalledWith(250);

    chooseUnit(field.select, "mbps");
    expect(field.input.value).toBe("0.25");
    expect(field.onChange).toHaveBeenLastCalledWith(250);

    field.dispose();
  });

  it("синхронизируется со значением из props, пока поле не в фокусе", () => {
    const field = mount({ value: 1000 });

    field.setValue(2500);
    flushSync();
    expect(field.input.value).toBe("2.5");

    field.input.dispatchEvent(new Event("focus"));
    flushSync();
    field.setValue(7000);
    flushSync();
    expect(field.input.value).toBe("2.5");

    field.input.value = "3,5";
    field.input.dispatchEvent(new Event("input", { bubbles: true }));
    field.input.dispatchEvent(new Event("blur"));
    flushSync();
    expect(field.onChange).toHaveBeenLastCalledWith(3500);
    expect(field.input.value).toBe("3.5");

    field.dispose();
  });

  it("не даёт вводить значение при disabled", () => {
    const field = mount({ value: 1000, disabled: true });

    expect(field.input.disabled).toBe(true);
    expect(field.select.disabled).toBe(true);

    field.dispose();
  });
});
