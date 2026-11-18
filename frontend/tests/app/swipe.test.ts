import {
  blocksSwipe,
  isHorizontalScrollable,
  isMobileWidth,
  neighborPath,
  sheetDismissDirection,
  swipeDirection,
} from "@/app/swipe";

function scrollable(overflowX: "auto" | "scroll", scrollWidth: number, clientWidth: number): HTMLDivElement {
  const element = document.createElement("div");
  element.style.overflowX = overflowX;
  Object.defineProperty(element, "scrollWidth", { value: scrollWidth, configurable: true });
  Object.defineProperty(element, "clientWidth", { value: clientWidth, configurable: true });
  return element;
}

describe("swipe helpers", () => {
  afterEach(() => {
    document.body.innerHTML = "";
  });

  it("detects horizontal swipes and ignores short or vertical gestures", () => {
    expect(swipeDirection({ x: 300, y: 100 }, { x: 180, y: 104 })).toBe("left");
    expect(swipeDirection({ x: 180, y: 100 }, { x: 300, y: 96 })).toBe("right");
    expect(swipeDirection({ x: 300, y: 100 }, { x: 280, y: 100 })).toBeNull();
    expect(swipeDirection({ x: 300, y: 100 }, { x: 180, y: 220 })).toBeNull();
  });

  it("detects a downward sheet dismiss and rejects upward or horizontal gestures", () => {
    expect(sheetDismissDirection({ x: 100, y: 100 }, { x: 104, y: 220 })).toBe("down");
    expect(sheetDismissDirection({ x: 100, y: 220 }, { x: 100, y: 100 })).toBeNull();
    expect(sheetDismissDirection({ x: 100, y: 100 }, { x: 240, y: 150 })).toBeNull();
  });

  it("finds neighboring primary paths without wrapping", () => {
    const paths = ["/", "/clients", "/interfaces", "/stats"];
    expect(neighborPath(paths, "/clients", "left")).toBe("/interfaces");
    expect(neighborPath(paths, "/clients", "right")).toBe("/");
    expect(neighborPath(paths, "/stats", "left")).toBeNull();
    expect(neighborPath(paths, "/", "right")).toBeNull();
    expect(neighborPath(paths, "/tariffs", "left")).toBeNull();
  });

  it("detects the mobile viewport width", () => {
    const original = window.innerWidth;
    Object.defineProperty(window, "innerWidth", { value: 390, configurable: true });
    expect(isMobileWidth()).toBe(true);
    Object.defineProperty(window, "innerWidth", { value: 1280, configurable: true });
    expect(isMobileWidth()).toBe(false);
    Object.defineProperty(window, "innerWidth", { value: original, configurable: true });
  });

  it("blocks swipes that start on form controls or horizontally scrollable areas", () => {
    const input = document.createElement("input");
    document.body.append(input);
    expect(blocksSwipe(input)).toBe(true);

    const scroll = scrollable("auto", 480, 320);
    const child = document.createElement("span");
    scroll.append(child);
    document.body.append(scroll);
    expect(isHorizontalScrollable(scroll)).toBe(true);
    expect(isHorizontalScrollable(child)).toBe(true);
    expect(blocksSwipe(child)).toBe(true);

    const staticBox = scrollable("auto", 320, 320);
    document.body.append(staticBox);
    expect(isHorizontalScrollable(staticBox)).toBe(false);
    expect(blocksSwipe(null)).toBe(false);
  });
});
