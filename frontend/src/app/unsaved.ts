import { askConfirm } from "@/app/confirm";
import { t } from "@/i18n";

import { hasUnsavedChanges } from "./unsaved-state";

export {
  hasUnsavedChanges,
  markClean,
  markDirty,
  registerUnsaved,
  resetUnsavedRegistry,
  unregisterUnsaved,
} from "./unsaved-state";

export async function confirmLeave(): Promise<boolean> {
  if (!hasUnsavedChanges()) return true;
  return askConfirm({
    title: t("unsaved.title"),
    message: t("unsaved.message"),
    confirmLabel: t("unsaved.confirm"),
    cancelLabel: t("unsaved.cancel"),
    tone: "danger",
  });
}
