import { configureValidation } from "@ivlev-dev/silent-validation";

import { i18n } from "@/i18n/store";
import type { Locale } from "@/i18n/types";

/**
 * Держит встроенные сообщения `@ivlev-dev/silent-validation` на языке интерфейса.
 *
 * Импортируется напрямую из `@/i18n/store`, чтобы не появился цикл
 * `i18n/index.ts` → `app/validation.ts` → `i18n/index.ts`.
 */
export function syncValidationLocale(next: Locale = i18n.current): void {
  configureValidation({ locale: next });
}
