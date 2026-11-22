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
  passwordPolicyIssue,
  type PasswordPolicyIssue,
} from "@/domain/validation";
import { t, type TranslationKey } from "@/i18n";

const PASSWORD_ISSUE_KEYS: Record<PasswordPolicyIssue, TranslationKey> = {
  short: "profile.password.error.tooShort",
  long: "profile.password.error.tooLong",
  common: "profile.password.error.weak",
  email: "profile.password.error.email",
};

function passwordIssueMessage(form: PasswordForm, value: unknown): string {
  const issue = passwordPolicyIssue(String(value), form.email);
  return issue === null ? t("profile.password.error.weak") : t(PASSWORD_ISSUE_KEYS[issue]);
}

export class PasswordForm extends Form {
  /** Email владельца нужен для проверки совпадения с локальной частью. */
  public email: string;

  @Field()
  @Required({ message: () => t("profile.password.error.currentRequired") })
  public accessor currentPassword: string = "";

  @Field()
  @Required({ message: () => t("profile.password.error.tooShort") })
  @MinLength(MIN_PASSWORD_LENGTH, {
    message: () => t("profile.password.error.tooShort"),
  })
  @MaxLength(MAX_PASSWORD_LENGTH, {
    message: () => t("profile.password.error.tooLong"),
  })
  @Custom(
    (value, context) =>
      passwordPolicyIssue(String(value), (context.instance as PasswordForm).email) === null,
    {
      message: ({ value, instance }) => passwordIssueMessage(instance as PasswordForm, value),
      when: (form: object) => (form as PasswordForm).nextPassword.length > 0,
    },
  )
  public accessor nextPassword: string = "";

  @Field()
  @Required({ message: () => t("profile.password.error.mismatch") })
  @Custom(
    (value, context) => value === (context.instance as PasswordForm).nextPassword,
    {
      message: () => t("profile.password.error.mismatch"),
      when: (form: object) => (form as PasswordForm).repeatPassword.length > 0,
    },
  )
  public accessor repeatPassword: string = "";

  constructor(email: string = "") {
    super({ formId: "profile-password", validateOnInput: true });
    this.email = email;
  }
}
