import { reactive } from "@ivlev-dev/silent-core";

import { currentPage, pageCount } from "./table-pagination";

export interface TableRow {
  readonly id: string;
}

export class SelectionModel {
  @reactive accessor selectedIds: string[] = [];

  constructor(private readonly items: () => readonly TableRow[]) {}

  get selectedCount(): number {
    return this.selectedIds.length;
  }

  get allSelected(): boolean {
    const rows = this.items();
    return rows.length > 0 && rows.every((row) => this.isSelected(row.id));
  }

  isSelected(id: string): boolean {
    return this.selectedIds.includes(id);
  }

  toggleSelected(id: string): void {
    this.selectedIds = this.isSelected(id)
      ? this.selectedIds.filter((value) => value !== id)
      : [...this.selectedIds, id];
  }

  toggleSelectAll(): void {
    this.selectedIds = this.allSelected ? [] : this.items().map((row) => row.id);
  }

  clearSelection(): void {
    this.selectedIds = [];
  }
}

export class TableController extends SelectionModel {
  @reactive accessor page = 1;
  @reactive accessor pageSize: number;

  constructor(
    private readonly options: {
      readonly items: () => readonly TableRow[];
      readonly total: () => number;
      readonly onPageChange: () => void;
      readonly initialPageSize?: number;
    },
  ) {
    super(options.items);
    this.pageSize = options.initialPageSize ?? 25;
  }

  get pageCount(): number {
    return pageCount(this.options.total(), this.pageSize);
  }

  get currentPage(): number {
    return currentPage(this.page, this.options.total(), this.pageSize);
  }

  goToPage(page: number): void {
    const next = Math.min(Math.max(1, Math.round(page)), this.pageCount);
    if (next === this.page) return;
    this.page = next;
    this.clearSelection();
    this.options.onPageChange();
  }

  setPageSize(value: string): void {
    const size = Number(value);
    if (!Number.isFinite(size) || size <= 0 || size === this.pageSize) return;
    this.pageSize = Math.trunc(size);
    this.page = 1;
    this.clearSelection();
    this.options.onPageChange();
  }
}
