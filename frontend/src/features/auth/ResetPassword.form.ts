import {
  Custom,
  Field,
  Form,
  MaxLength,
  MinLength,
  Required,
} from "@ivlev-dev/silent-form";

import {
  MAX_PASSWORD_LENGTH,
  MIN_PASSWORD_LENGTH,
  isCommonPassword,
} from "@/domain/validation";
import { t } from "@/i18n";

export class ResetPasswordForm extends Form {
  @Field()
  @Required({ message: () => t("auth.reset.error.password") })
  @MinLength(MIN_PASSWORD_LENGTH, { message: () => t("auth.reset.error.password") })
  @MaxLength(MAX_PASSWORD_LENGTH, { message: () => t("auth.reset.error.passwordTooLong") })
  @Custom(
    (value) => !isCommonPassword(String(value)),
    {
      message: () => t("auth.reset.error.passwordWeak"),
      when: (form: object) => (form as ResetPasswordForm).password.length > 0,
    },
  )
  public accessor password: string = "";

  @Field()
  @Required({ message: () => t("auth.reset.error.mismatch") })
  @Custom(
    (value, context) => value === (context.instance as ResetPasswordForm).password,
    {
      message: () => t("auth.reset.error.mismatch"),
      when: (form: object) => (form as ResetPasswordForm).repeatPassword.length > 0,
    },
  )
  public accessor repeatPassword: string = "";

  constructor() {
    super({ formId: "reset-password", validateOnInput: true });
  }
}
