import { Field, Form, Matches, Required } from "@ivlev-dev/silent-form";

import { t } from "@/i18n";

/** Бэкенд допускает `admin@local`, поэтому TLD не требуется. */
export const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+$/;

export class ForgotPasswordForm extends Form {
  @Field()
  @Required({ message: () => t("auth.forgot.error.email") })
  @Matches(EMAIL_PATTERN, { message: () => t("auth.forgot.error.email") })
  public accessor email: string = "";

  constructor() {
    super({ formId: "forgot-password", validateOnInput: true });
  }
}
