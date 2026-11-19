export const FIELD_SELECTOR = [
  "input:not([disabled]):not([type=\"hidden\"])",
  "select:not([disabled])",
  "textarea:not([disabled])",
].join(",");

export const FOCUSABLE_SELECTOR = [
  "a[href]",
  "area[href]",
  "button:not([disabled])",
  "input:not([disabled]):not([type=\"hidden\"])",
  "select:not([disabled])",
  "textarea:not([disabled])",
  "iframe",
  "object",
  "embed",
  "summary",
  "[contenteditable=\"true\"]",
  "[tabindex]:not([tabindex=\"-1\"])",
].join(",");

export interface BackgroundSnapshot {
  element: Element;
  inert: boolean;
  ariaHidden: string | null;
}

export function isFocusableElement(element: HTMLElement): boolean {
  if (element.hasAttribute("disabled")) return false;
  if (element.getAttribute("aria-hidden") === "true") return false;
  if (element.tabIndex < 0) return false;
  if (element.closest("[hidden]") !== null) return false;
  return true;
}

export function focusableElements(
  root: Element,
  selector: string = FOCUSABLE_SELECTOR,
): HTMLElement[] {
  return Array.from(root.querySelectorAll<HTMLElement>(selector)).filter(isFocusableElement);
}

export function trapTab(event: KeyboardEvent, root: Element | null): void {
  if (event.key !== "Tab" || root === null) return;
  const focusables = focusableElements(root);
  if (focusables.length === 0) {
    event.preventDefault();
    if (root instanceof HTMLElement) root.focus();
    return;
  }
  const first = focusables[0];
  const last = focusables[focusables.length - 1];
  if (first === undefined || last === undefined) return;
  const active = document.activeElement;
  const index = active instanceof HTMLElement ? focusables.indexOf(active) : -1;
  if (index === -1) {
    event.preventDefault();
    (event.shiftKey ? last : first).focus();
    return;
  }
  if (event.shiftKey && index === 0) {
    event.preventDefault();
    last.focus();
    return;
  }
  if (!event.shiftKey && index === focusables.length - 1) {
    event.preventDefault();
    first.focus();
  }
}

export interface BackgroundGuard {
  suppress(root: Element | null, exempt?: (element: Element) => boolean): void;
  restore(): void;
}

export function createBackgroundGuard(): BackgroundGuard {
  let background: BackgroundSnapshot[] = [];

  const restore = (): void => {
    for (let index = background.length - 1; index >= 0; index -= 1) {
      const snapshot = background[index];
      if (snapshot === undefined) continue;
      if (snapshot.inert) snapshot.element.setAttribute("inert", "");
      else snapshot.element.removeAttribute("inert");
      if (snapshot.ariaHidden === null) snapshot.element.removeAttribute("aria-hidden");
      else snapshot.element.setAttribute("aria-hidden", snapshot.ariaHidden);
    }
    background = [];
  };

  return {
    suppress(root: Element | null, exempt?: (element: Element) => boolean): void {
      restore();
      if (root === null) return;
      let node: Element = root;
      while (node.parentElement !== null) {
        const parent = node.parentElement;
        if (parent === document.body) break;
        for (const sibling of Array.from(parent.children)) {
          if (sibling === node) continue;
          if (exempt?.(sibling) === true) continue;
          background.push({
            element: sibling,
            inert: sibling.hasAttribute("inert"),
            ariaHidden: sibling.getAttribute("aria-hidden"),
          });
          sibling.setAttribute("inert", "");
          sibling.setAttribute("aria-hidden", "true");
        }
        node = parent;
      }
    },
    restore,
  };
}
