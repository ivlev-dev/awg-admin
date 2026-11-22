import { reactive } from "@ivlev-dev/silent-core";
import { Field, Form, Required } from "@ivlev-dev/silent-form";
import { Custom, MaxLength, MinLength } from "@ivlev-dev/silent-validation";

import { MAX_PASSWORD_LENGTH, MIN_PASSWORD_LENGTH } from "@/domain/validation";
import { t } from "@/i18n";

import { passwordIssueMessage } from "./password-issue";

export class ResetPasswordForm extends Form {
  /** Email пользователя: нужен для проверки совпадения пароля с локальной частью. */
  @reactive public accessor targetEmail = "";

  @Field()
  @Required()
  @MinLength(MIN_PASSWORD_LENGTH, { message: () => t("error.validation.passwordShort") })
  @MaxLength(MAX_PASSWORD_LENGTH, { message: () => t("error.validation.passwordLong") })
  @Custom(
    (value, context) => {
      const form = context.instance as ResetPasswordForm;
      return passwordIssueMessage(String(value ?? ""), form.targetEmail.trim()) === null;
    },
    {
      message: (context) => {
        const form = context.instance as ResetPasswordForm;
        return (
          passwordIssueMessage(String(context.value ?? ""), form.targetEmail.trim())
          ?? t("error.validation.passwordShort")
        );
      },
    },
  )
  public accessor newPassword: string = "";

  constructor(options: ConstructorParameters<typeof Form>[0] = {}) {
    super({
      formId: "users-reset-form",
      labels: { newPassword: t("users.reset.password") },
      ...options,
    });
  }
}
