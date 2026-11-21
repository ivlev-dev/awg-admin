import { TableController } from "@/app/table-controller";

function rows(count: number): Array<{ id: string }> {
  return Array.from({ length: count }, (_value, index) => ({ id: `row-${index}` }));
}

describe("TableController", () => {
  it("управляет страницей и сбрасывает выделение", () => {
    const items = rows(60);
    const change = vi.fn();
    const table = new TableController({
      items: () => items,
      total: () => items.length,
      onPageChange: change,
      initialPageSize: 25,
    });

    table.toggleSelected("row-0");
    table.goToPage(2);

    expect(table.page).toBe(2);
    expect(table.selectedIds).toEqual([]);
    expect(change).toHaveBeenCalledTimes(1);
  });

  it("не выходит за границы страниц", () => {
    const items = rows(10);
    const table = new TableController({
      items: () => items,
      total: () => items.length,
      onPageChange: () => undefined,
      initialPageSize: 25,
    });

    table.goToPage(99);
    expect(table.currentPage).toBe(1);
    expect(table.pageCount).toBe(1);
  });

  it("меняет размер страницы и возвращается на первую", () => {
    const items = rows(100);
    const change = vi.fn();
    const table = new TableController({
      items: () => items,
      total: () => items.length,
      onPageChange: change,
      initialPageSize: 25,
    });
    table.goToPage(3);

    table.setPageSize("50");

    expect(table.pageSize).toBe(50);
    expect(table.page).toBe(1);
    expect(change).toHaveBeenCalledTimes(2);
  });

  it("выделяет и снимает выделение со всех строк", () => {
    const items = rows(3);
    const table = new TableController({
      items: () => items,
      total: () => items.length,
      onPageChange: () => undefined,
      initialPageSize: 25,
    });

    table.toggleSelectAll();
    expect(table.allSelected).toBe(true);
    expect(table.selectedIds).toEqual(["row-0", "row-1", "row-2"]);

    table.toggleSelected("row-1");
    expect(table.selectedIds).toEqual(["row-0", "row-2"]);

    table.clearSelection();
    expect(table.selectedIds).toEqual([]);
  });
});
