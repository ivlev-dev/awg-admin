import { createComponent, flushSync } from "@ivlev-dev/silent-core";

import { Modal } from "@/components/Modal";
import { Select } from "@/components/Select";

const OPTIONS = [
  { value: "a", label: "Первый" },
  { value: "b", label: "Второй" },
];

function mountModal(): ReturnType<typeof createComponent> {
  const result = createComponent(Modal, {
    open: true,
    title: "Проверка",
    onClose: () => undefined,
    children: document.createElement("div"),
  });
  document.body.appendChild(result.node);
  return result;
}

function mountSelect(): ReturnType<typeof createComponent> {
  const result = createComponent(Select, {
    value: "a",
    options: OPTIONS,
    onChange: () => undefined,
  });
  document.body.appendChild(result.node);
  return result;
}

function trigger(): HTMLButtonElement {
  const element = document.querySelector<HTMLButtonElement>(".select-trigger");
  if (element === null) throw new Error("select trigger not found");
  return element;
}

function activeListeners(
  add: ReturnType<typeof vi.spyOn>,
  remove: ReturnType<typeof vi.spyOn>,
): number {
  return add.mock.calls.length - remove.mock.calls.length;
}

afterEach(() => {
  document.body.replaceChildren();
});

describe("Жизненный цикл document-листенеров оверлеев", () => {
  it("не копит листенеры после 20 mount/unmount модалки", async () => {
    const add = vi.spyOn(document, "addEventListener");
    const remove = vi.spyOn(document, "removeEventListener");

    let baselineNet = 0;

    for (let cycle = 0; cycle < 21; cycle += 1) {
      const modal = mountModal();
      await modal.ready;
      flushSync();
      modal.dispose();
      document.body.replaceChildren();
      if (cycle === 0) baselineNet = activeListeners(add, remove);
    }

    expect(add).toHaveBeenCalled();
    expect(activeListeners(add, remove)).toBe(baselineNet);
  });

  it("не создаёт document-листенеры у закрытой модалки", async () => {
    const add = vi.spyOn(document, "addEventListener");
    const remove = vi.spyOn(document, "removeEventListener");

    const modal = createComponent(Modal, {
      open: false,
      title: "Закрыта",
      onClose: () => undefined,
    });
    document.body.appendChild(modal.node);
    await modal.ready;
    flushSync();

    expect(document.querySelector(".modal")).toBeNull();
    expect(add).not.toHaveBeenCalled();
    expect(remove).not.toHaveBeenCalled();

    modal.dispose();
  });

  it("снимает pointerdown селекта после 20 open/unmount", async () => {
    const add = vi.spyOn(document, "addEventListener");
    const remove = vi.spyOn(document, "removeEventListener");

    let baselineNet = 0;

    for (let cycle = 0; cycle < 21; cycle += 1) {
      const select = mountSelect();
      await select.ready;
      flushSync();
      trigger().click();
      flushSync();
      expect(document.querySelector(".select2__menu")).not.toBeNull();
      select.dispose();
      document.body.replaceChildren();
      if (cycle === 0) baselineNet = activeListeners(add, remove);
    }

    expect(add).toHaveBeenCalled();
    expect(activeListeners(add, remove)).toBe(baselineNet);
  });

  it("не держит pointerdown у закрытого селекта", async () => {
    const add = vi.spyOn(document, "addEventListener");

    const select = mountSelect();
    await select.ready;
    flushSync();

    expect(document.querySelector(".select2__menu")).toBeNull();
    expect(add).not.toHaveBeenCalled();

    select.dispose();
  });
});
