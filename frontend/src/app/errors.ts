import { setErrorHandler } from "@ivlev-dev/silent-core";

import type { ApiError } from "@/domain/errors";
import { t, type TranslationKey } from "@/i18n";
import type { ToastStore } from "./toast";

const ACCOUNT_BLOCK_MESSAGES: Readonly<Record<string, TranslationKey>> = {
  pending_approval: "auth.login.error.pendingApproval",
  rejected: "auth.login.error.rejected",
  account_disabled: "users.form.disabled",
};

interface BlockedSession {
  logout(): Promise<void>;
}

interface ErrorToasts {
  error(message: string): void;
}

export function installGlobalErrorHandler(toasts: ToastStore): void {
  setErrorHandler((error: unknown, component: (...args: never[]) => unknown) => {
    const name = component.name.length > 0 ? component.name : "component";
    console.error(`Unhandled UI error (${name})`, error);
    toasts.error(t("app.error.runtime"));
  });
}

export function createForbiddenHandler(
  session: BlockedSession,
  toasts: ErrorToasts,
): (error: ApiError) => void {
  let pending = false;
  return (error: ApiError): void => {
    const key = ACCOUNT_BLOCK_MESSAGES[error.code];
    if (key === undefined || pending) return;
    pending = true;
    toasts.error(t(key));
    void session.logout().finally(() => {
      pending = false;
    });
  };
}
