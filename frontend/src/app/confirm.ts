import { reactive } from "@ivlev-dev/silent-core";

export type ConfirmTone = "danger" | "primary";

export interface ConfirmOptions {
  readonly title: string;
  readonly message: string;
  readonly confirmLabel?: string;
  readonly cancelLabel?: string;
  readonly tone?: ConfirmTone;
}

export interface ConfirmState extends ConfirmOptions {
  readonly resolve: (value: boolean) => void;
}

export class ConfirmStore {
  @reactive accessor state: ConfirmState | null = null;

  ask(options: ConfirmOptions): Promise<boolean> {
    this.state?.resolve(false);
    return new Promise((resolve) => {
      this.state = { ...options, resolve };
    });
  }

  accept(): void {
    const state = this.state;
    if (state === null) return;
    this.state = null;
    state.resolve(true);
  }

  cancel(): void {
    const state = this.state;
    if (state === null) return;
    this.state = null;
    state.resolve(false);
  }
}

export const confirmStore = new ConfirmStore();

export function askConfirm(options: ConfirmOptions): Promise<boolean> {
  return confirmStore.ask(options);
}
