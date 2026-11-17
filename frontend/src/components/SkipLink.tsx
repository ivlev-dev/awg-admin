import { t } from "@/i18n";

export const MAIN_CONTENT_ID = "main-content";

export function SkipLink() {
  return (
    <a class="skip-link" href={`#${MAIN_CONTENT_ID}`}>
      {t("app.skipToContent")}
    </a>
  );
}
