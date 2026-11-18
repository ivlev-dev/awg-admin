import { createComponent, createSignal, flushSync } from "@ivlev-dev/silent-core";
import type { ComponentResult } from "@ivlev-dev/silent-core";

import type { CommandItem } from "@/app/command";
import { CommandPalette } from "@/components/CommandPalette";

const ITEMS: readonly CommandItem[] = [
  { id: "nav:overview", title: "Обзор", hint: "/", icon: "overview", path: "/" },
  { id: "nav:clients", title: "Клиенты", hint: "/clients", icon: "clients", path: "/clients" },
  { id: "action:theme", title: "Сменить тему", hint: "Оформление", icon: "moon" },
];

interface MountedPalette {
  result: ComponentResult;
  setOpen: (value: boolean) => void;
  runs: CommandItem[];
  closeCalls: () => number;
}

const disposers: Array<() => void> = [];

function mountPalette(options: { open?: boolean; items?: readonly CommandItem[] } = {}): MountedPalette {
  const [open, setOpen] = createSignal(options.open ?? true);
  const runs: CommandItem[] = [];
  let closes = 0;
  const result = createComponent(CommandPalette, {
    get open() {
      return open();
    },
    items: options.items ?? ITEMS,
    onRun: (item: CommandItem) => {
      runs.push(item);
    },
    onClose: () => {
      closes += 1;
      setOpen(false);
      flushSync();
    },
  });
  document.body.appendChild(result.node);
  disposers.push(result.dispose);
  return {
    result,
    setOpen: (value: boolean) => {
      setOpen(value);
      flushSync();
    },
    runs,
    closeCalls: () => closes,
  };
}

async function ready(instance: MountedPalette): Promise<void> {
  await instance.result.ready;
  flushSync();
  await Promise.resolve();
}

function palette(): HTMLElement | null {
  return document.querySelector<HTMLElement>(".command-palette");
}

function input(): HTMLInputElement {
  const field = document.querySelector<HTMLInputElement>(".command-palette__input");
  if (field === null) throw new Error("command input not found");
  return field;
}

function options(): HTMLElement[] {
  return Array.from(document.querySelectorAll<HTMLElement>("[role=\"option\"]"));
}

function pressKey(target: EventTarget, key: string, init: KeyboardEventInit = {}): KeyboardEvent {
  const event = new KeyboardEvent("keydown", { key, bubbles: true, cancelable: true, ...init });
  target.dispatchEvent(event);
  flushSync();
  return event;
}

function typeQuery(value: string): void {
  const field = input();
  field.value = value;
  field.dispatchEvent(new Event("input", { bubbles: true }));
  flushSync();
}

afterEach(() => {
  for (const dispose of disposers.splice(0)) dispose();
  document.body.replaceChildren();
});

describe("CommandPalette", () => {
  it("рисует диалог, комбобокс и список опций", async () => {
    const instance = mountPalette();
    await ready(instance);

    const root = palette();
    expect(root).not.toBeNull();
    expect(root?.getAttribute("role")).toBe("dialog");
    expect(root?.getAttribute("aria-modal")).toBe("true");

    const field = input();
    expect(field.getAttribute("role")).toBe("combobox");
    expect(field.getAttribute("aria-expanded")).toBe("true");
    expect(field.getAttribute("aria-controls")).toBe(document.querySelector("[role=\"listbox\"]")?.id);
    expect(document.activeElement).toBe(field);

    expect(document.querySelector("[role=\"listbox\"]")).not.toBeNull();
    expect(options()).toHaveLength(ITEMS.length);
    expect(options()[0]?.getAttribute("aria-selected")).toBe("true");
  });

  it("закрывается по Escape", async () => {
    const instance = mountPalette();
    await ready(instance);

    const event = pressKey(document, "Escape");

    expect(event.defaultPrevented).toBe(true);
    expect(instance.closeCalls()).toBe(1);
    expect(palette()).toBeNull();
  });

  it("фильтрует элементы по введённому запросу и показывает пустое состояние", async () => {
    const instance = mountPalette();
    await ready(instance);

    typeQuery("клиент");

    expect(options().map((option) => option.textContent)).toEqual([expect.stringContaining("Клиенты")]);
    expect(options()).toHaveLength(1);

    typeQuery("абракадабра");

    expect(options()).toHaveLength(0);
    expect(document.querySelector(".command-palette__empty")?.textContent).toBe("Ничего не найдено");
  });

  it("перемещает выбор стрелками и запускает выбранный пункт по Enter", async () => {
    const instance = mountPalette();
    await ready(instance);

    pressKey(document, "ArrowDown");
    expect(options()[1]?.getAttribute("aria-selected")).toBe("true");

    pressKey(document, "ArrowUp");
    pressKey(document, "ArrowUp");
    expect(options()[0]?.getAttribute("aria-selected")).toBe("true");

    pressKey(document, "ArrowDown");
    pressKey(document, "Enter");

    expect(instance.runs).toHaveLength(1);
    expect(instance.runs[0]?.id).toBe("nav:clients");
  });

  it("не выходит за границы списка стрелками", async () => {
    const instance = mountPalette();
    await ready(instance);

    pressKey(document, "ArrowUp");
    expect(options()[0]?.getAttribute("aria-selected")).toBe("true");

    for (let step = 0; step < ITEMS.length + 2; step += 1) pressKey(document, "ArrowDown");
    expect(options()[ITEMS.length - 1]?.getAttribute("aria-selected")).toBe("true");
  });

  it("запускает пункт по клику", async () => {
    const instance = mountPalette();
    await ready(instance);

    options()[2]?.click();
    flushSync();

    expect(instance.runs).toHaveLength(1);
    expect(instance.runs[0]?.id).toBe("action:theme");
  });

  it("удерживает фокус внутри палитры по Tab", async () => {
    const instance = mountPalette();
    await ready(instance);

    const field = input();
    const forward = pressKey(field, "Tab");
    expect(forward.defaultPrevented).toBe(true);
    expect(document.activeElement).toBe(field);

    const backward = pressKey(field, "Tab", { shiftKey: true });
    expect(backward.defaultPrevented).toBe(true);
    expect(document.activeElement).toBe(field);
  });

  it("закрывается по клику на backdrop", async () => {
    const instance = mountPalette();
    await ready(instance);

    const backdrop = document.querySelector<HTMLElement>(".command-backdrop");
    backdrop?.dispatchEvent(new MouseEvent("click", { bubbles: true, cancelable: true }));
    flushSync();

    expect(instance.closeCalls()).toBe(1);
    expect(palette()).toBeNull();
  });

  it("не отвечает на клавиатуру, когда закрыта", async () => {
    const instance = mountPalette({ open: false });
    await ready(instance);

    expect(palette()).toBeNull();
    pressKey(document, "Enter");
    pressKey(document, "Escape");

    expect(instance.closeCalls()).toBe(0);
    expect(instance.runs).toHaveLength(0);

    instance.setOpen(true);
    await Promise.resolve();
    expect(palette()).not.toBeNull();
  });
});
