import { CommandStore, filterCommands, type CommandItem } from "@/app/command";

const ITEMS: readonly CommandItem[] = [
  { id: "overview", title: "Обзор", hint: "/", path: "/" },
  { id: "clients", title: "Клиенты", hint: "Устройства и IP-адреса", path: "/clients" },
  { id: "theme", title: "Сменить тему", hint: "Оформление", run: () => undefined },
];

describe("filterCommands", () => {
  it("возвращает все пункты для пустого запроса", () => {
    expect(filterCommands(ITEMS, "")).toEqual(ITEMS);
    expect(filterCommands(ITEMS, "   ")).toEqual(ITEMS);
  });

  it("ищет по заголовку без учёта регистра", () => {
    expect(filterCommands(ITEMS, "КЛИЕН").map((item) => item.id)).toEqual(["clients"]);
    expect(filterCommands(ITEMS, "сменить").map((item) => item.id)).toEqual(["theme"]);
  });

  it("ищет по подсказке", () => {
    expect(filterCommands(ITEMS, "устройства").map((item) => item.id)).toEqual(["clients"]);
    expect(filterCommands(ITEMS, "оформление").map((item) => item.id)).toEqual(["theme"]);
  });

  it("возвращает пустой список, если совпадений нет", () => {
    expect(filterCommands(ITEMS, "несуществующий раздел")).toEqual([]);
  });
});

describe("CommandStore", () => {
  it("открывает, закрывает и переключает палитру", () => {
    const store = new CommandStore();

    expect(store.open).toBe(false);

    store.openPalette();
    expect(store.open).toBe(true);

    store.toggle();
    expect(store.open).toBe(false);

    store.toggle();
    expect(store.open).toBe(true);

    store.close();
    expect(store.open).toBe(false);
  });

  it("сбрасывает запрос и выбранный пункт при открытии и закрытии", () => {
    const store = new CommandStore();
    store.setQuery("клиент");
    store.setSelected(2);

    store.openPalette();

    expect(store.query).toBe("");
    expect(store.selected).toBe(0);

    store.setQuery("обз");
    store.setSelected(1);
    store.close();

    expect(store.query).toBe("");
    expect(store.selected).toBe(0);
  });

  it("сбрасывает выбранный пункт при изменении запроса", () => {
    const store = new CommandStore();
    store.setCount(3);
    store.move(2);

    expect(store.selected).toBe(2);

    store.setQuery("клиент");

    expect(store.selected).toBe(0);
  });

  it("не выходит за границы при перемещении", () => {
    const store = new CommandStore();
    store.setCount(3);

    store.move(-1);
    expect(store.selected).toBe(0);

    store.move(1);
    expect(store.selected).toBe(1);

    store.move(10);
    expect(store.selected).toBe(2);

    store.move(-10);
    expect(store.selected).toBe(0);
  });

  it("удерживает выбор в допустимых границах при смене размера списка", () => {
    const store = new CommandStore();
    store.setCount(3);
    store.move(2);

    store.setCount(1);

    expect(store.selected).toBe(0);

    store.setCount(0);
    store.move(1);

    expect(store.selected).toBe(0);
  });

  it("возвращает выбранный пункт с учётом границ", () => {
    const store = new CommandStore();

    expect(store.selectedItem([])).toBeUndefined();

    store.setCount(3);
    expect(store.selectedItem(ITEMS)).toEqual(ITEMS[0]);

    store.move(10);
    expect(store.selectedItem(ITEMS)).toEqual(ITEMS[2]);
  });

  it("запускает действие выбранного пункта", () => {
    const action = vi.fn();
    const items: readonly CommandItem[] = [
      { id: "one", title: "Первый", path: "/" },
      { id: "two", title: "Второй", run: action },
    ];
    const store = new CommandStore();
    store.setCount(items.length);

    expect(store.runSelected(items)).toEqual(items[0]);
    expect(action).not.toHaveBeenCalled();

    store.move(1);

    expect(store.runSelected(items)).toEqual(items[1]);
    expect(action).toHaveBeenCalledTimes(1);
  });

  it("не запускает действие для пустого списка", () => {
    const store = new CommandStore();

    expect(store.runSelected([])).toBeUndefined();
  });
});
