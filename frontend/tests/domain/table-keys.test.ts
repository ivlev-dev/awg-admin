import { isActivation, isRowInteractiveTarget, tableKeyAction } from "@/domain/table-keys";

describe("table keyboard navigation", () => {
  it("maps Enter and space to activation", () => {
    expect(tableKeyAction("Enter")).toBe("activate");
    expect(tableKeyAction(" ")).toBe("activate");
    expect(tableKeyAction("Spacebar")).toBe("activate");
    expect(isActivation("Enter")).toBe(true);
    expect(isActivation(" ")).toBe(true);
  });

  it("maps vertical arrows to row movement", () => {
    expect(tableKeyAction("ArrowDown")).toBe("next");
    expect(tableKeyAction("ArrowUp")).toBe("previous");
    expect(isActivation("ArrowDown")).toBe(false);
  });

  it("ignores other keys", () => {
    expect(tableKeyAction("Tab")).toBeNull();
    expect(tableKeyAction("Escape")).toBeNull();
    expect(tableKeyAction("ArrowLeft")).toBeNull();
    expect(tableKeyAction("a")).toBeNull();
    expect(tableKeyAction("")).toBeNull();
    expect(isActivation("Tab")).toBe(false);
  });

  it("detects interactive targets inside a row", () => {
    const row = document.createElement("tr");
    const button = document.createElement("button");
    const input = document.createElement("input");
    const link = document.createElement("a");
    const cell = document.createElement("td");
    cell.appendChild(button);
    row.appendChild(input);
    row.appendChild(link);
    row.appendChild(cell);

    expect(isRowInteractiveTarget(button)).toBe(true);
    expect(isRowInteractiveTarget(input)).toBe(true);
    expect(isRowInteractiveTarget(link)).toBe(true);
    expect(isRowInteractiveTarget(cell)).toBe(false);
    expect(isRowInteractiveTarget(row)).toBe(false);
    expect(isRowInteractiveTarget(null)).toBe(false);
  });
});
