import {
  compareBoolean,
  compareNumber,
  compareText,
  nextSort,
  sortIndicator,
} from "@/domain/table-sort";

describe("table sorting", () => {
  it("toggles direction for the same key and resets for a new one", () => {
    expect(nextSort(null, "name")).toEqual({ key: "name", direction: "asc" });
    expect(nextSort({ key: "name", direction: "asc" }, "name")).toEqual({
      key: "name",
      direction: "desc",
    });
    expect(nextSort({ key: "name", direction: "desc" }, "status")).toEqual({
      key: "status",
      direction: "asc",
    });
  });

  it("shows an indicator only for the active key", () => {
    const state = { key: "name", direction: "desc" } as const;
    expect(sortIndicator(state, "name")).toBe("▼");
    expect(sortIndicator({ key: "name", direction: "asc" }, "name")).toBe("▲");
    expect(sortIndicator(state, "status")).toBe("");
    expect(sortIndicator(null, "name")).toBe("");
  });

  it("compares text, numbers and booleans in both directions", () => {
    expect(compareText("а", "б", "asc")).toBeLessThan(0);
    expect(compareText("а", "б", "desc")).toBeGreaterThan(0);
    expect(compareNumber(1, 2, "asc")).toBeLessThan(0);
    expect(compareNumber(1, 2, "desc")).toBeGreaterThan(0);
    expect(compareBoolean(true, false, "asc")).toBeGreaterThan(0);
    expect(compareBoolean(true, false, "desc")).toBeLessThan(0);
  });
});
