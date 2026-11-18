import { createComponent, flushSync } from "@ivlev-dev/silent-core";

import { confirmStore, askConfirm } from "@/app/confirm";
import { ConfirmDialog } from "@/components/ConfirmDialog";

const disposers: Array<() => void> = [];

async function mount() {
  const result = createComponent(ConfirmDialog, {});
  document.body.appendChild(result.node);
  disposers.push(result.dispose);
  await result.ready;
  flushSync();
  return result;
}

function button(label: string): HTMLButtonElement {
  const found = Array.from(document.querySelectorAll<HTMLButtonElement>(".modal button")).find(
    (element) => element.textContent?.trim() === label,
  );
  if (found === undefined) throw new Error(`button "${label}" not found`);
  return found;
}

afterEach(() => {
  confirmStore.cancel();
  for (const dispose of disposers.splice(0)) dispose();
  document.body.replaceChildren();
});

describe("ConfirmDialog", () => {
  it("shows title, message and custom labels, and accepts", async () => {
    const pending = askConfirm({
      title: "Удалить группу",
      message: "Группа используется?",
      confirmLabel: "Удалить",
      cancelLabel: "Отмена",
    });
    await mount();

    const modal = document.querySelector<HTMLElement>(".modal");
    expect(modal?.textContent).toContain("Удалить группу");
    expect(modal?.textContent).toContain("Группа используется?");
    expect(document.activeElement).toBe(button("Удалить"));

    button("Удалить").click();
    flushSync();
    await expect(pending).resolves.toBe(true);
    expect(document.querySelector(".modal")).toBeNull();
  });

  it("cancels from the cancel button and from the backdrop close", async () => {
    const pending = askConfirm({ title: "Удалить", message: "Точно?" });
    await mount();

    button("Отмена").click();
    flushSync();
    await expect(pending).resolves.toBe(false);

    const second = askConfirm({ title: "Удалить", message: "Точно?" });
    flushSync();
    const backdrop = document.querySelector<HTMLElement>(".confirm-backdrop");
    if (backdrop === null) throw new Error("backdrop not found");
    backdrop.click();
    flushSync();
    await expect(second).resolves.toBe(false);
  });

  it("uses the danger variant by default and primary when requested", async () => {
    const first = askConfirm({ title: "Удалить", message: "1" });
    await mount();
    expect(document.querySelector(".modal button.btn--danger")).not.toBeNull();
    button("Подтвердить").click();
    flushSync();
    await first;

    const second = askConfirm({ title: "Продолжить", message: "2", tone: "primary" });
    flushSync();
    expect(document.querySelector(".modal button.btn--primary")).not.toBeNull();
    button("Подтвердить").click();
    flushSync();
    await second;
  });
});
