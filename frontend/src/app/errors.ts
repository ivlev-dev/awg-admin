import { setErrorHandler } from "@ivlev-dev/silent-core";

import { t } from "@/i18n";
import type { ToastStore } from "./toast";

export function installGlobalErrorHandler(toasts: ToastStore): void {
  setErrorHandler((error: unknown, component: (...args: never[]) => unknown) => {
    const name = component.name.length > 0 ? component.name : "component";
    console.error(`Необработанная ошибка интерфейса (${name})`, error);
    toasts.error(t("app.error.runtime"));
  });
}
