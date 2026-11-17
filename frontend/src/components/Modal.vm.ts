import { ViewModel, createEffect, createRoot } from "@ivlev-dev/silent-core";
import type { Children } from "@ivlev-dev/silent-core";

export interface ModalProps {
  open: boolean;
  title: string;
  onClose: () => void;
  children?: Children;
  footer?: Children;
  wide?: boolean;
  closable?: boolean;
  ariaLabel?: string;
}

const FOCUSABLE_SELECTOR = [
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

interface BackgroundSnapshot {
  element: Element;
  inert: boolean;
  ariaHidden: string | null;
}

const openModals: ModalVM[] = [];
let titleCounter = 0;

function removeFromStack(vm: ModalVM): void {
  const index = openModals.indexOf(vm);
  if (index !== -1) openModals.splice(index, 1);
}

export class ModalVM extends ViewModel<ModalProps> {
  readonly titleId = `modal-title-${++titleCounter}`;

  private open = false;
  private shouldFocus = false;
  private opener: HTMLElement | null = null;
  private root: HTMLElement | null = null;
  private stopEffect: (() => void) | null = null;
  private background: BackgroundSnapshot[] = [];
  private focusRetries = 0;

  override mounted(): void {
    document.addEventListener("keydown", this.onKeydown);
    this.stopEffect = createRoot((dispose) => {
      createEffect(() => {
        this.syncOpen(this.props.open);
      });
      return dispose;
    });
  }

  override unmounted(): void {
    document.removeEventListener("keydown", this.onKeydown);
    this.stopEffect?.();
    this.stopEffect = null;
    removeFromStack(this);
    this.restoreBackground();
    if (this.open) {
      this.open = false;
      this.restoreFocus();
    }
    this.root = null;
  }

  attachRoot(element: Element | null): void {
    this.root = element instanceof HTMLElement ? element : null;
    if (this.shouldFocus) this.tryFocusInitial();
  }

  private syncOpen(open: boolean): void {
    if (open === this.open) return;
    this.open = open;
    if (open) {
      const active = document.activeElement;
      this.opener = active instanceof HTMLElement ? active : null;
      openModals.push(this);
      this.shouldFocus = true;
      this.focusRetries = 0;
      this.tryFocusInitial();
      this.suppressBackground();
      return;
    }
    removeFromStack(this);
    this.restoreBackground();
    this.restoreFocus();
  }

  private tryFocusInitial(): void {
    if (!this.shouldFocus) return;
    const root = this.root;
    if (root === null || !root.isConnected) {
      if (this.focusRetries >= 2) return;
      this.focusRetries += 1;
      queueMicrotask(() => this.tryFocusInitial());
      return;
    }
    this.focusRetries = 0;
    this.shouldFocus = false;
    const focusables = this.focusables();
    (focusables[0] ?? root).focus();
  }

  private restoreFocus(): void {
    this.shouldFocus = false;
    this.focusRetries = 0;
    const opener = this.opener;
    this.opener = null;
    if (opener !== null && opener.isConnected) opener.focus();
  }

  private focusables(): HTMLElement[] {
    const root = this.root;
    if (root === null) return [];
    return Array.from(root.querySelectorAll<HTMLElement>(FOCUSABLE_SELECTOR)).filter((element) => this.isFocusable(element));
  }

  private isFocusable(element: HTMLElement): boolean {
    if (element.hasAttribute("disabled")) return false;
    if (element.getAttribute("aria-hidden") === "true") return false;
    if (element.closest("[hidden]") !== null) return false;
    return true;
  }

  private suppressBackground(): void {
    this.restoreBackground();
    const root = this.root;
    if (root === null) return;
    let node: Element = root;
    while (node.parentElement !== null) {
      const parent = node.parentElement;
      if (parent === document.body) break;
      for (const sibling of Array.from(parent.children)) {
        if (sibling === node || this.containsOpenModal(sibling)) continue;
        this.background.push({
          element: sibling,
          inert: sibling.hasAttribute("inert"),
          ariaHidden: sibling.getAttribute("aria-hidden"),
        });
        sibling.setAttribute("inert", "");
        sibling.setAttribute("aria-hidden", "true");
      }
      node = parent;
    }
  }

  private restoreBackground(): void {
    for (let index = this.background.length - 1; index >= 0; index -= 1) {
      const snapshot = this.background[index];
      if (snapshot === undefined) continue;
      if (snapshot.inert) snapshot.element.setAttribute("inert", "");
      else snapshot.element.removeAttribute("inert");
      if (snapshot.ariaHidden === null) snapshot.element.removeAttribute("aria-hidden");
      else snapshot.element.setAttribute("aria-hidden", snapshot.ariaHidden);
    }
    this.background = [];
  }

  private containsOpenModal(element: Element): boolean {
    return openModals.some((modal) => modal !== this && modal.root !== null && element.contains(modal.root));
  }

  private isTop(): boolean {
    return openModals.length > 0 && openModals[openModals.length - 1] === this;
  }

  private readonly onKeydown = (event: KeyboardEvent): void => {
    if (!this.open || !this.isTop() || event.defaultPrevented) return;
    if (event.key === "Escape") {
      if (this.props.closable === false) return;
      event.preventDefault();
      this.props.onClose();
      return;
    }
    if (event.key !== "Tab") return;
    const root = this.root;
    if (root === null) return;
    const focusables = this.focusables();
    if (focusables.length === 0) {
      event.preventDefault();
      root.focus();
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
  };
}
