import {
  Custom,
  Field,
  Form,
  MaxLength,
  MinLength,
  Matches,
  Required,
} from "@ivlev-dev/silent-form";

import { FULL_NAME_MAX } from "@/application/guards";
import {
  MAX_PASSWORD_LENGTH,
  MIN_PASSWORD_LENGTH,
  passwordPolicyIssue,
} from "@/domain/validation";
import { t } from "@/i18n";

/** Бэкенд допускает `admin@local`, поэтому TLD не требуется. */
export const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+$/;

function passwordIssueMessage(form: RegisterForm, value: unknown): string {
  const issue = passwordPolicyIssue(String(value), form.email.trim());
  return issue === "email"
    ? t("auth.register.error.passwordEmail")
    : t("auth.register.error.passwordWeak");
}

export class RegisterForm extends Form {
  @Field()
  @Required({ message: () => t("auth.register.error.email") })
  @Matches(EMAIL_PATTERN, { message: () => t("auth.register.error.email") })
  public accessor email: string = "";

  @Field()
  @MaxLength(FULL_NAME_MAX, { message: () => t("auth.register.error.fullName") })
  public accessor fullName: string = "";

  @Field()
  @Required({ message: () => t("auth.register.error.password") })
  @MinLength(MIN_PASSWORD_LENGTH, { message: () => t("auth.register.error.password") })
  @MaxLength(MAX_PASSWORD_LENGTH, { message: () => t("auth.register.error.passwordTooLong") })
  @Custom(
    (value, context) => {
      const issue = passwordPolicyIssue(String(value), (context.instance as RegisterForm).email);
      return issue !== "common" && issue !== "email";
    },
    {
      message: ({ value, instance }) => passwordIssueMessage(instance as RegisterForm, value),
      when: (form: object) => (form as RegisterForm).password.length > 0,
    },
  )
  public accessor password: string = "";

  @Field()
  @Required({ message: () => t("auth.register.error.mismatch") })
  @Custom(
    (value, context) => value === (context.instance as RegisterForm).password,
    {
      message: () => t("auth.register.error.mismatch"),
      when: (form: object) => (form as RegisterForm).repeatPassword.length > 0,
    },
  )
  public accessor repeatPassword: string = "";

  constructor() {
    super({ formId: "register", validateOnInput: true });
  }
}
