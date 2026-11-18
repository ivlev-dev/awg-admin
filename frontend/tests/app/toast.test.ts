import { ToastStore } from "@/app/toast";

describe("ToastStore", () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("auto-dismisses after the ttl", () => {
    const store = new ToastStore();
    store.push("Готово", "success", 1000);
    expect(store.items).toHaveLength(1);

    vi.advanceTimersByTime(999);
    expect(store.items).toHaveLength(1);
    vi.advanceTimersByTime(1);
    expect(store.items).toHaveLength(0);
  });

  it("pauses and resumes the remaining time", () => {
    const store = new ToastStore();
    store.push("Пауза", "info", 1000);
    const id = store.items[0]?.id;
    if (id === undefined) throw new Error("toast not created");

    vi.advanceTimersByTime(600);
    store.pause(id);
    vi.advanceTimersByTime(5000);
    expect(store.items).toHaveLength(1);

    store.resume(id);
    vi.advanceTimersByTime(399);
    expect(store.items).toHaveLength(1);
    vi.advanceTimersByTime(1);
    expect(store.items).toHaveLength(0);
  });

  it("replaces a duplicate message instead of stacking it", () => {
    const store = new ToastStore();
    store.push("Одинаково", "info");
    const firstId = store.items[0]?.id;
    store.push("Одинаково", "info");

    expect(store.items).toHaveLength(1);
    expect(store.items[0]?.id).not.toBe(firstId);
  });

  it("keeps at most four visible toasts and drops the oldest", () => {
    const store = new ToastStore();
    for (let index = 0; index < 5; index += 1) {
      store.push(`Сообщение ${index}`, "info");
    }

    expect(store.items).toHaveLength(4);
    expect(store.items.map((item) => item.message)).toEqual([
      "Сообщение 1",
      "Сообщение 2",
      "Сообщение 3",
      "Сообщение 4",
    ]);
  });

  it("dismisses manually and cancels the timer", () => {
    const store = new ToastStore();
    store.push("Закрыть", "error");
    const id = store.items[0]?.id;
    if (id === undefined) throw new Error("toast not created");

    store.dismiss(id);
    vi.advanceTimersByTime(10000);
    expect(store.items).toHaveLength(0);
  });
});
