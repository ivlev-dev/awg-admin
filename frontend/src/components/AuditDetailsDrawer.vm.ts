import { ViewModel, computed, createEffect, createRoot } from "@ivlev-dev/silent-core";

import type { AuditRowView } from "@/features/audit/AuditPage.vm";
import { focusableElements, trapTab } from "@/components/overlay";

export interface AuditDetailsDrawerProps {
  row: AuditRowView | null;
  onClose: () => void;
  onCopy: (row: AuditRowView) => void;
}

const EMPTY_VALUE = "—";

let drawerCounter = 0;

function statusTone(status: number): string {
  if (status >= 500) return "error";
  if (status >= 400) return "warn";
  if (status >= 200 && status < 300) return "ok";
  return "info";
}

export class AuditDetailsDrawerVM extends ViewModel<AuditDetailsDrawerProps> {
  readonly titleId = `audit-drawer-title-${(drawerCounter += 1)}`;

  private open = false;
  private shouldFocus = false;
  private opener: HTMLElement | null = null;
  private root: HTMLElement | null = null;
  private stopEffect: (() => void) | null = null;
  private focusRetries = 0;

  @computed
  get time(): string {
    return this.props.row?.at ?? EMPTY_VALUE;
  }

  @computed
  get actor(): string {
    return this.props.row?.actor ?? EMPTY_VALUE;
  }

  @computed
  get actorId(): string | null {
    return this.props.row?.actorId ?? null;
  }

  @computed
  get action(): string {
    return this.props.row?.action ?? EMPTY_VALUE;
  }

  @computed
  get entity(): string {
    return this.props.row?.entity ?? EMPTY_VALUE;
  }

  @computed
  get entityId(): string | null {
    return this.props.row?.entityId ?? null;
  }

  @computed
  get status(): string {
    const row = this.props.row;
    return row === null ? EMPTY_VALUE : String(row.status);
  }

  @computed
  get statusTone(): string {
    const row = this.props.row;
    return row === null ? "info" : statusTone(row.status);
  }

  @computed
  get ip(): string {
    return this.props.row?.ip ?? EMPTY_VALUE;
  }

  @computed
  get details(): string {
    const value = this.props.row?.details;
    return value !== null && value !== undefined && value.length > 0 ? value : EMPTY_VALUE;
  }

  @computed
  get canCopy(): boolean {
    const value = this.props.row?.details;
    return value !== null && value !== undefined && value.length > 0;
  }

  override mounted(): void {
    document.addEventListener("keydown", this.onKeydown);
    this.stopEffect = createRoot((dispose) => {
      createEffect(() => {
        this.syncOpen(this.props.row !== null);
      });
      return dispose;
    });
  }

  override unmounted(): void {
    document.removeEventListener("keydown", this.onKeydown);
    this.stopEffect?.();
    this.stopEffect = null;
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

  close(): void {
    this.props.onClose();
  }

  copy(): void {
    const row = this.props.row;
    if (row === null) return;
    this.props.onCopy(row);
  }

  backdropClick(event: MouseEvent): void {
    if (event.target === event.currentTarget) this.close();
  }

  private syncOpen(open: boolean): void {
    if (open === this.open) return;
    this.open = open;
    if (open) {
      const active = document.activeElement;
      this.opener = active instanceof HTMLElement ? active : null;
      this.shouldFocus = true;
      this.focusRetries = 0;
      this.tryFocusInitial();
      return;
    }
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
    const target = root.querySelector<HTMLElement>("[data-autofocus]") ?? this.focusables()[0] ?? root;
    target.focus();
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

  private readonly onKeydown = (event: KeyboardEvent): void => {
    if (!this.open || event.defaultPrevented) return;
    if (event.key === "Escape") {
      event.preventDefault();
      this.close();
      return;
    }
    trapTab(event, this.root);
  };
}
