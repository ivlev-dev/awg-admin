import { createComponent, createSignal, flushSync } from "@ivlev-dev/silent-core";
import type { Children, ComponentResult } from "@ivlev-dev/silent-core";

import { Modal } from "@/components/Modal";

interface MountedOptions {
  open?: boolean;
  title?: string;
  closable?: boolean;
  ariaLabel?: string;
  children?: Children;
  footer?: Children;
  host?: HTMLElement;
}

interface MountedModal {
  result: ComponentResult;
  setOpen: (value: boolean) => void;
  closeCalls: () => number;
}

const disposers: Array<() => void> = [];

function mountModal(options: MountedOptions = {}): MountedModal {
  const [open, setOpen] = createSignal(options.open ?? true);
  let calls = 0;
  const result = createComponent(Modal, {
    get open() {
      return open();
    },
    title: options.title ?? "Настройки",
    ariaLabel: options.ariaLabel,
    closable: options.closable,
    children: options.children,
    footer: options.footer,
    onClose: () => {
      calls += 1;
      setOpen(false);
      flushSync();
    },
  });
  (options.host ?? document.body).appendChild(result.node);
  const instance: MountedModal = {
    result,
    setOpen: (value: boolean) => {
      setOpen(value);
      flushSync();
    },
    closeCalls: () => calls,
  };
  disposers.push(result.dispose);
  return instance;
}

function modalRoot(title = "Настройки"): HTMLElement {
  const labelled = Array.from(document.querySelectorAll<HTMLElement>(".modal")).find((element) => {
    const id = element.getAttribute("aria-labelledby");
    return id !== null && document.getElementById(id)?.textContent === title;
  });
  if (labelled === undefined) throw new Error(`modal "${title}" not found`);
  return labelled;
}

function closeButton(root: HTMLElement): HTMLButtonElement {
  const button = root.querySelector<HTMLButtonElement>("button[aria-label=\"Закрыть\"]");
  if (button === null) throw new Error("close button not found");
  return button;
}

function pressKey(target: EventTarget, key: string, shiftKey = false): KeyboardEvent {
  const event = new KeyboardEvent("keydown", { key, shiftKey, bubbles: true, cancelable: true });
  target.dispatchEvent(event);
  return event;
}

async function ready(instance: MountedModal): Promise<void> {
  await instance.result.ready;
  flushSync();
}

afterEach(() => {
  for (const dispose of disposers.splice(0)) dispose();
  document.body.replaceChildren();
});

describe("Modal a11y", () => {
  it("фокусирует [data-autofocus] или первое поле, а не крестик", async () => {
    const input = document.createElement("input");
    input.id = "first-field";
    const autofocus = document.createElement("select");
    autofocus.setAttribute("data-autofocus", "");
    autofocus.id = "autofocus-field";

    const first = mountModal({ children: [input] });
    await ready(first);
    expect(document.activeElement).toBe(input);
    first.setOpen(false);

    const second = mountModal({ children: [input, autofocus] });
    await ready(second);
    expect(document.activeElement).toBe(autofocus);
  });

  it("переводит фокус на первый интерактивный элемент и выставляет aria-атрибуты", async () => {
    const opener = document.createElement("button");
    opener.textContent = "Открыть";
    document.body.appendChild(opener);
    opener.focus();

    const instance = mountModal();
    await ready(instance);

    const root = modalRoot();
    expect(root.getAttribute("role")).toBe("dialog");
    expect(root.getAttribute("aria-modal")).toBe("true");
    expect(root.getAttribute("tabindex")).toBe("-1");

    const labelId = root.getAttribute("aria-labelledby");
    expect(labelId).not.toBeNull();
    expect(document.getElementById(labelId ?? "")?.textContent).toBe("Настройки");
    expect(document.activeElement).toBe(closeButton(root));
  });

  it("фокусирует контейнер, если интерактивных элементов нет", async () => {
    const instance = mountModal({ title: "", ariaLabel: "Диалог", closable: false, children: "Только текст" });
    await ready(instance);

    const root = document.querySelector<HTMLElement>(".modal");
    expect(root).not.toBeNull();
    expect(root?.getAttribute("aria-label")).toBe("Диалог");
    expect(document.activeElement).toBe(root);
  });

  it("замыкает Tab и Shift+Tab внутри модалки", async () => {
    const input = document.createElement("input");
    input.id = "modal-field";
    const action = document.createElement("button");
    action.type = "button";
    action.id = "modal-action";
    action.textContent = "Действие";

    const instance = mountModal({ children: [input, action] });
    await ready(instance);

    const root = modalRoot();
    const first = closeButton(root);
    expect(document.activeElement).toBe(input);

    action.focus();
    const forward = pressKey(action, "Tab");
    expect(forward.defaultPrevented).toBe(true);
    expect(document.activeElement).toBe(first);

    const backward = pressKey(first, "Tab", true);
    expect(backward.defaultPrevented).toBe(true);
    expect(document.activeElement).toBe(action);
  });

  it("закрывается по Escape и возвращает фокус открывающему элементу", async () => {
    const opener = document.createElement("button");
    opener.textContent = "Открыть";
    document.body.appendChild(opener);
    opener.focus();

    const instance = mountModal();
    await ready(instance);
    expect(document.querySelector(".modal")).not.toBeNull();

    const event = pressKey(document, "Escape");

    expect(event.defaultPrevented).toBe(true);
    expect(instance.closeCalls()).toBe(1);
    expect(document.querySelector(".modal")).toBeNull();
    expect(document.activeElement).toBe(opener);
  });

  it("не закрывается по Escape и клику по backdrop, если closable=false", async () => {
    const instance = mountModal({ closable: false, children: "Только текст" });
    await ready(instance);

    const root = modalRoot();
    pressKey(root, "Escape");
    expect(instance.closeCalls()).toBe(0);

    const backdrop = root.parentElement;
    expect(backdrop).not.toBeNull();
    backdrop?.dispatchEvent(new MouseEvent("click", { bubbles: true, cancelable: true }));
    expect(instance.closeCalls()).toBe(0);
    expect(document.querySelector(".modal")).not.toBeNull();
  });

  it("изолирует фон через inert и aria-hidden", async () => {
    const shell = document.createElement("div");
    const background = document.createElement("div");
    const backgroundButton = document.createElement("button");
    backgroundButton.type = "button";
    backgroundButton.textContent = "Фон";
    background.appendChild(backgroundButton);
    const host = document.createElement("div");
    shell.appendChild(background);
    shell.appendChild(host);
    document.body.appendChild(shell);

    backgroundButton.focus();

    const instance = mountModal({ host });
    await ready(instance);

    expect(background.hasAttribute("inert")).toBe(true);
    expect(background.getAttribute("aria-hidden")).toBe("true");
    expect(document.activeElement).toBe(closeButton(modalRoot()));

    instance.setOpen(false);

    expect(background.hasAttribute("inert")).toBe(false);
    expect(background.getAttribute("aria-hidden")).toBeNull();
    expect(document.activeElement).toBe(backgroundButton);
  });

  it("возвращает фокус при программном закрытии", async () => {
    const opener = document.createElement("button");
    opener.textContent = "Открыть";
    document.body.appendChild(opener);
    opener.focus();

    const instance = mountModal();
    await ready(instance);

    instance.setOpen(false);

    expect(document.querySelector(".modal")).toBeNull();
    expect(document.activeElement).toBe(opener);
  });

  it("держит стек вложенных модалок", async () => {
    const parentAction = document.createElement("button");
    parentAction.type = "button";
    parentAction.textContent = "Действие родителя";
    const parent = mountModal({ title: "Родитель", children: parentAction });
    await ready(parent);

    parentAction.focus();

    const childAction = document.createElement("button");
    childAction.type = "button";
    childAction.textContent = "Действие ребёнка";
    const child = mountModal({ title: "Ребёнок", children: childAction });
    await ready(child);

    const childRoot = modalRoot("Ребёнок");
    const parentRoot = modalRoot("Родитель");
    expect(childRoot).not.toBeNull();
    expect(document.activeElement).toBe(childAction);

    childAction.focus();
    const forward = pressKey(childAction, "Tab");
    expect(forward.defaultPrevented).toBe(true);
    expect(document.activeElement).toBe(closeButton(childRoot));

    pressKey(document, "Escape");
    expect(child.closeCalls()).toBe(1);
    expect(parent.closeCalls()).toBe(0);
    expect(document.querySelectorAll(".modal")).toHaveLength(1);
    expect(document.activeElement).toBe(parentAction);

    pressKey(document, "Escape");
    expect(parent.closeCalls()).toBe(1);
    expect(document.querySelectorAll(".modal")).toHaveLength(0);
    expect(parentRoot.isConnected).toBe(false);
  });
});
