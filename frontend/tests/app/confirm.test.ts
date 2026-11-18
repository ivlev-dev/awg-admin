import { confirmStore, askConfirm } from "@/app/confirm";

async function settled(promise: Promise<boolean>): Promise<boolean> {
  return promise;
}

describe("confirm store", () => {
  afterEach(() => {
    confirmStore.cancel();
  });

  it("resolves true on accept and clears the state", async () => {
    const pending = askConfirm({ title: "Удалить", message: "Точно?" });
    expect(confirmStore.state?.title).toBe("Удалить");

    confirmStore.accept();
    await expect(settled(pending)).resolves.toBe(true);
    expect(confirmStore.state).toBeNull();
  });

  it("resolves false on cancel", async () => {
    const pending = askConfirm({ title: "Удалить", message: "Точно?" });
    confirmStore.cancel();
    await expect(settled(pending)).resolves.toBe(false);
    expect(confirmStore.state).toBeNull();
  });

  it("cancels a pending request when a new one replaces it", async () => {
    const first = askConfirm({ title: "Первый", message: "1" });
    const second = askConfirm({ title: "Второй", message: "2" });

    await expect(settled(first)).resolves.toBe(false);
    expect(confirmStore.state?.title).toBe("Второй");
    confirmStore.accept();
    await expect(settled(second)).resolves.toBe(true);
  });

  it("keeps tone and custom labels", async () => {
    void askConfirm({
      title: "Перезапуск",
      message: "Продолжить?",
      confirmLabel: "Перезапустить",
      cancelLabel: "Остаться",
      tone: "primary",
    });
    expect(confirmStore.state?.confirmLabel).toBe("Перезапустить");
    expect(confirmStore.state?.cancelLabel).toBe("Остаться");
    expect(confirmStore.state?.tone).toBe("primary");
  });
});
