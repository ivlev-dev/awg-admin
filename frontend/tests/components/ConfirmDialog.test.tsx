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
  it("фокусирует отмену и связывает описание через aria-describedby", async () => {
    const pending = askConfirm({ title: "Удалить", message: "Точно?" });
    await mount();

    const dialog = document.querySelector<HTMLElement>(".modal");
    const describedBy = dialog?.getAttribute("aria-describedby");
    expect(describedBy).toBe("confirm-dialog-message");
    expect(document.getElementById(describedBy ?? "")?.textContent).toBe("Точно?");
    expect(document.activeElement).toBe(button("Отмена"));

    button("Отмена").click();
    flushSync();
    await pending;
  });

  it("возвращает фокус инициатору после закрытия", async () => {
    const opener = document.createElement("button");
    opener.textContent = "Удалить";
    document.body.appendChild(opener);
    opener.focus();

    const pending = askConfirm({ title: "Удалить", message: "Точно?" });
    await mount();
    await Promise.resolve();

    button("Отмена").click();
    flushSync();
    await pending;

    expect(document.activeElement).toBe(opener);
  });

  it("Escape закрывает только подтверждение поверх модалки", async () => {
    const { Modal } = await import("@/components/Modal");
    const [open] = (await import("@ivlev-dev/silent-core")).createSignal(true);
    let modalCloses = 0;
    const modal = createComponent(Modal, {
      get open() {
        return open();
      },
      title: "Форма",
      onClose: () => {
        modalCloses += 1;
      },
      children: "Поле",
    });
    document.body.appendChild(modal.node);
    await modal.ready;
    flushSync();

    const pending = askConfirm({ title: "Удалить", message: "Точно?" });
    await mount();

    const cancel = button("Отмена");
    cancel.focus();
    cancel.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true, cancelable: true }));
    flushSync();

    await pending;
    expect(confirmStore.state).toBeNull();
    expect(modalCloses).toBe(0);
    expect(document.querySelectorAll(".modal").length).toBe(1);
    modal.dispose();
  });

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
    expect(document.activeElement).toBe(button("Отмена"));

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
