import { ViewModel, createEffect, createRoot } from "@ivlev-dev/silent-core";
import type { Children } from "@ivlev-dev/silent-core";

import {
  FIELD_SELECTOR,
  createBackgroundGuard,
  focusableElements,
  isFocusableElement,
  lockBodyScroll,
  trapTab,
  unlockBodyScroll,
} from "./overlay";

export interface ModalProps {
  open: boolean;
  title: string;
  onClose: () => void;
  children?: Children;
  footer?: Children;
  wide?: boolean;
  closable?: boolean;
  ariaLabel?: string;
  describedBy?: string;
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
  private readonly background = createBackgroundGuard();
  private focusRetries = 0;
  private listening = false;
  private scrollLocked = false;

  override mounted(): void {
    this.stopEffect = createRoot((dispose) => {
      createEffect(() => {
        this.syncOpen(this.props.open);
      });
      return dispose;
    });
  }

  override unmounted(): void {
    this.detachKeydown();
    this.stopEffect?.();
    this.stopEffect = null;
    removeFromStack(this);
    this.restoreBackground();
    this.unlockScroll();
    if (this.open) {
      this.open = false;
      this.restoreFocus();
    }
    this.root = null;
  }

  attachRoot(element: Element | null): void {
    this.root = element instanceof HTMLElement ? element : null;
    if (this.root !== null && this.open) this.suppressBackground();
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
      this.attachKeydown();
      this.tryFocusInitial();
      this.suppressBackground();
      this.lockScroll();
      return;
    }
    this.detachKeydown();
    removeFromStack(this);
    this.restoreBackground();
    this.unlockScroll();
    this.restoreFocus();
  }

  private lockScroll(): void {
    if (this.scrollLocked) return;
    this.scrollLocked = true;
    lockBodyScroll();
  }

  private unlockScroll(): void {
    if (!this.scrollLocked) return;
    this.scrollLocked = false;
    unlockBodyScroll();
  }

  private attachKeydown(): void {
    if (this.listening) return;
    this.listening = true;
    document.addEventListener("keydown", this.onKeydown);
  }

  private detachKeydown(): void {
    if (!this.listening) return;
    this.listening = false;
    document.removeEventListener("keydown", this.onKeydown);
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
    const target = this.initialTarget() ?? root;
    target.focus();
  }

  private initialTarget(): HTMLElement | null {
    const root = this.root;
    if (root === null) return null;
    const requested = root.querySelector<HTMLElement>("[data-autofocus]");
    if (requested !== null && isFocusableElement(requested)) return requested;
    const body = root.querySelector<HTMLElement>(".modal__body");
    if (body !== null) {
      const field = body.querySelector<HTMLElement>(FIELD_SELECTOR);
      if (field !== null && isFocusableElement(field)) return field;
      const focusable = focusableElements(body).find((element) => isFocusableElement(element));
      if (focusable !== undefined) return focusable;
    }
    return this.focusables()[0] ?? null;
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
    return focusableElements(root);
  }

  private suppressBackground(): void {
    this.background.suppress(this.root, (element) => this.containsOpenModal(element));
  }

  private restoreBackground(): void {
    this.background.restore();
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
    trapTab(event, this.root);
  };
}
