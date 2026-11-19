import {
  PAGE_SIZES,
  currentPage,
  pageCount,
  pageSlice,
  pageWindow,
} from "@/app/table-pagination";

describe("table-pagination", () => {
  it("computes the page count with a minimum of one page", () => {
    expect(pageCount(0, 25)).toBe(1);
    expect(pageCount(25, 25)).toBe(1);
    expect(pageCount(26, 25)).toBe(2);
    expect(pageCount(100, 25)).toBe(4);
  });

  it("clamps the current page into the available range", () => {
    expect(currentPage(0, 100, 25)).toBe(1);
    expect(currentPage(2, 100, 25)).toBe(2);
    expect(currentPage(9, 100, 25)).toBe(4);
    expect(currentPage(9, 0, 25)).toBe(1);
  });

  it("slices the requested page", () => {
    const items = [1, 2, 3, 4, 5, 6];
    expect(pageSlice(items, 1, 2)).toEqual([1, 2]);
    expect(pageSlice(items, 3, 2)).toEqual([5, 6]);
    expect(pageSlice(items, 4, 2)).toEqual([]);
  });

  it("returns the visible window", () => {
    expect(pageWindow(100, 2, 25)).toEqual({ page: 2, pageCount: 4, from: 26, to: 50 });
    expect(pageWindow(100, 4, 25)).toEqual({ page: 4, pageCount: 4, from: 76, to: 100 });
    expect(pageWindow(0, 1, 25)).toEqual({ page: 1, pageCount: 1, from: 0, to: 0 });
  });

  it("exposes the shared page sizes", () => {
    expect(PAGE_SIZES).toEqual([10, 25, 50, 100]);
  });
});
