import { isRecord, persistedSignal, stringField } from "./persisted";

interface Filters {
  query: string;
}

function validate(value: unknown): Filters | null {
  if (!isRecord(value)) return null;
  const query = stringField(value, "query", 20);
  return query === null ? null : { query };
}

class MemoryStorage {
  private readonly store = new Map<string, string>();

  getItem(key: string): string | null {
    return this.store.get(key) ?? null;
  }

  setItem(key: string, value: string): void {
    this.store.set(key, value);
  }

  removeItem(key: string): void {
    this.store.delete(key);
  }

  clear(): void {
    this.store.clear();
  }
}

beforeEach(() => {
  vi.stubGlobal("localStorage", new MemoryStorage());
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("persistedSignal", () => {
  it("возвращает начальное значение без сохранённых данных", () => {
    const signal = persistedSignal<Filters>("awg.test.filters", { query: "" }, validate);

    expect(signal.read()).toEqual({ query: "" });
    expect(signal.key).toBe("awg.test.filters.v1");
  });

  it("сохраняет и читает значение под версионированным ключом", () => {
    const signal = persistedSignal<Filters>("awg.test.filters", { query: "" }, validate, {
      version: 3,
    });

    signal.write({ query: "pixel" });

    expect(signal.key).toBe("awg.test.filters.v3");
    expect(localStorage.getItem("awg.test.filters.v3")).toBe('{"query":"pixel"}');

    const restored = persistedSignal<Filters>("awg.test.filters", { query: "" }, validate, {
      version: 3,
    });
    expect(restored.read()).toEqual({ query: "pixel" });
  });

  it("не читает значение другой версии", () => {
    localStorage.setItem("awg.test.filters.v1", '{"query":"legacy"}');
    const signal = persistedSignal<Filters>("awg.test.filters", { query: "" }, validate, {
      version: 2,
    });

    expect(signal.read()).toEqual({ query: "" });
    expect(localStorage.getItem("awg.test.filters.v1")).not.toBeNull();
  });

  it("сбрасывает повреждённый JSON и возвращает начальное значение", () => {
    localStorage.setItem("awg.test.filters.v1", "{not json");
    const signal = persistedSignal<Filters>("awg.test.filters", { query: "" }, validate);

    expect(signal.read()).toEqual({ query: "" });
    expect(localStorage.getItem("awg.test.filters.v1")).toBeNull();
  });

  it("сбрасывает значение, не прошедшее валидацию", () => {
    localStorage.setItem("awg.test.filters.v1", '{"query":42}');
    const signal = persistedSignal<Filters>("awg.test.filters", { query: "" }, validate);

    expect(signal.read()).toEqual({ query: "" });
    expect(localStorage.getItem("awg.test.filters.v1")).toBeNull();
  });

  it("сбрасывает значение, если валидатор выбросил ошибку", () => {
    localStorage.setItem("awg.test.filters.v1", '"anything"');
    const signal = persistedSignal<Filters>(
      "awg.test.filters",
      { query: "" },
      () => {
        throw new Error("broken validator");
      },
    );

    expect(signal.read()).toEqual({ query: "" });
    expect(localStorage.getItem("awg.test.filters.v1")).toBeNull();
  });

  it("очищает сохранённое значение", () => {
    const signal = persistedSignal<Filters>("awg.test.filters", { query: "" }, validate);
    signal.write({ query: "laptop" });

    signal.clear();

    expect(localStorage.getItem(signal.key)).toBeNull();
    expect(signal.read()).toEqual({ query: "" });
  });

  it("работает без localStorage", () => {
    vi.stubGlobal("localStorage", undefined);
    const signal = persistedSignal<Filters>("awg.test.filters", { query: "" }, validate);

    expect(signal.read()).toEqual({ query: "" });
    expect(() => signal.write({ query: "pixel" })).not.toThrow();
    expect(() => signal.clear()).not.toThrow();
  });

  it("не падает, если localStorage бросает ошибку доступа", () => {
    vi.stubGlobal("localStorage", {
      getItem: () => {
        throw new Error("denied");
      },
      setItem: () => {
        throw new Error("denied");
      },
      removeItem: () => {
        throw new Error("denied");
      },
    });
    const signal = persistedSignal<Filters>("awg.test.filters", { query: "" }, validate);

    expect(signal.read()).toEqual({ query: "" });
    expect(() => signal.write({ query: "pixel" })).not.toThrow();
    expect(() => signal.clear()).not.toThrow();
  });
});

describe("persisted helpers", () => {
  it("распознаёт только объекты", () => {
    expect(isRecord({})).toBe(true);
    expect(isRecord([])).toBe(false);
    expect(isRecord(null)).toBe(false);
    expect(isRecord("text")).toBe(false);
  });

  it("читает строковое поле и обрезает слишком длинное значение", () => {
    const record: Record<string, unknown> = { query: "abcdef", missing: 1 };

    expect(stringField(record, "query", 3)).toBe("abc");
    expect(stringField(record, "query", 100)).toBe("abcdef");
    expect(stringField(record, "missing")).toBeNull();
    expect(stringField(record, "text")).toBeNull();
  });
});
