import { createComponent, createSignal, flushSync } from "@ivlev-dev/silent-core";

import { Select } from "@/components/Select";
import type { SelectOption } from "@/components/Select.vm";

interface Mounted {
  readonly trigger: HTMLButtonElement;
  readonly onChange: ReturnType<typeof vi.fn>;
  readonly dispose: () => void;
}

function mount(options: SelectOption[], searchable?: boolean): Mounted {
  const [value, setValue] = createSignal("");
  const onChange = vi.fn((next: string) => setValue(next));
  const result = createComponent(Select, {
    id: "test-select",
    get value() {
      return value();
    },
    options,
    onChange,
    searchable,
    ariaLabel: "Test",
  });
  document.body.appendChild(result.node);
  flushSync();
  const trigger = document.querySelector<HTMLButtonElement>("#test-select");
  if (trigger === null) throw new Error("select trigger is missing");
  return { trigger, onChange, dispose: result.dispose };
}

function open(mounted: Mounted): void {
  mounted.trigger.click();
  flushSync();
}

function searchInput(): HTMLInputElement {
  const input = document.querySelector<HTMLInputElement>(".select2__search input");
  if (input === null) throw new Error("search input is missing");
  return input;
}

function type(input: HTMLInputElement, value: string): void {
  input.value = value;
  input.dispatchEvent(new Event("input", { bubbles: true }));
  flushSync();
}

function press(target: HTMLElement, key: string): void {
  target.dispatchEvent(new KeyboardEvent("keydown", { key, bubbles: true, cancelable: true }));
  flushSync();
}

afterEach(() => {
  document.body.replaceChildren();
});

describe("Select", () => {
  it("фильтрует по label без учёта регистра и диакритики", () => {
    const mounted = mount([
      { value: "1", label: "Café Paris" },
      { value: "2", label: "Berlin" },
    ], true);
    open(mounted);

    type(searchInput(), "cafe");

    const labels = Array.from(document.querySelectorAll(".select2__option-label")).map(
      (element) => element.textContent,
    );
    expect(labels).toEqual(["Café Paris"]);
    mounted.dispose();
  });

  it("Enter выбирает активную опцию, Escape закрывает меню", () => {
    const mounted = mount([
      { value: "a", label: "Alpha" },
      { value: "b", label: "Beta" },
    ], true);
    open(mounted);

    type(searchInput(), "bet");
    press(searchInput(), "Enter");

    expect(mounted.onChange).toHaveBeenCalledWith("b");
    expect(document.querySelector(".select2__menu")).toBeNull();

    open(mounted);
    expect(document.querySelector(".select2__menu")).not.toBeNull();
    press(searchInput(), "Escape");
    expect(document.querySelector(".select2__menu")).toBeNull();

    mounted.dispose();
  });

  it("не рендерит больше лимита опций и показывает остаток", () => {
    const options = Array.from({ length: 2000 }, (_value, index) => ({
      value: String(index),
      label: `Option ${index}`,
    }));
    const mounted = mount(options);
    open(mounted);

    expect(document.querySelectorAll('[role="option"]').length).toBeLessThanOrEqual(100);
    expect(document.querySelector(".select2__more")?.textContent).toContain("1900");
    mounted.dispose();
  });

  it("навигация стрелками меняет активную опцию", () => {
    const mounted = mount([
      { value: "a", label: "Alpha" },
      { value: "b", label: "Beta" },
      { value: "c", label: "Gamma" },
    ], true);
    open(mounted);

    press(searchInput(), "ArrowDown");
    press(searchInput(), "Enter");

    expect(mounted.onChange).toHaveBeenCalledWith("b");
    mounted.dispose();
  });

  it("type-ahead выбирает опцию в обычном селекте", () => {
    const mounted = mount([
      { value: "a", label: "Alpha" },
      { value: "b", label: "Beta" },
      { value: "c", label: "Gamma" },
    ]);
    press(mounted.trigger, "g");
    press(mounted.trigger, "Enter");

    expect(mounted.onChange).toHaveBeenCalledWith("c");
    mounted.dispose();
  });
});
