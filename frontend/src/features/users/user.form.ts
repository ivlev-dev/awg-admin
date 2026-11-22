import { reactive } from "@ivlev-dev/silent-core";
import { Field, Form, Optional, Required, ValidateIf } from "@ivlev-dev/silent-form";
import {
  Custom,
  IsIn,
  Matches,
  MaxLength,
  MinLength,
} from "@ivlev-dev/silent-validation";

import type { Role } from "@/domain/types";
import { MAX_PASSWORD_LENGTH, MIN_PASSWORD_LENGTH } from "@/domain/validation";
import { t } from "@/i18n";

import { passwordIssueMessage } from "./password-issue";

/** Email без обязательного TLD: внутренние адреса вида `admin@local` допустимы. */
const EMAIL_PATTERN = /^\s*[^\s@]+@[^\s@]+\s*$/;
const EMAIL_MAX_LENGTH = 254;
const FULL_NAME_MAX_LENGTH = 200;

export class UserForm extends Form {
  /** Создание новой учётной записи: только тогда пароль обязателен. */
  @reactive public accessor creating = false;

  @Field()
  @Required({ message: () => t("users.form.error.email") })
  @Matches(EMAIL_PATTERN, { message: () => t("users.form.error.email") })
  @MaxLength(EMAIL_MAX_LENGTH)
  public accessor email: string = "";

  @Field()
  @Optional()
  @MaxLength(FULL_NAME_MAX_LENGTH, { message: () => t("users.form.error.fullName") })
  public accessor fullName: string = "";

  @Field()
  @ValidateIf((form: UserForm) => form.creating)
  @MinLength(MIN_PASSWORD_LENGTH, { message: () => t("error.validation.passwordShort") })
  @MaxLength(MAX_PASSWORD_LENGTH, { message: () => t("error.validation.passwordLong") })
  @Custom(
    (value, context) => {
      const form = context.instance as UserForm;
      return passwordIssueMessage(String(value ?? ""), form.email.trim()) === null;
    },
    {
      message: (context) => {
        const form = context.instance as UserForm;
        return (
          passwordIssueMessage(String(context.value ?? ""), form.email.trim())
          ?? t("error.validation.passwordShort")
        );
      },
    },
  )
  public accessor password: string = "";

  @Field()
  @IsIn(["admin", "user"] as const)
  public accessor role: Role = "user";

  @Field()
  @Optional()
  public accessor tariffId: string = "";

  @Field()
  @Optional()
  public accessor nodeId: string = "";

  @Field()
  public accessor disabled: boolean = false;

  constructor(options: ConstructorParameters<typeof Form>[0] = {}) {
    super({
      formId: "users-form",
      labels: {
        email: t("users.form.email"),
        fullName: t("users.form.fullName"),
        password: t("users.form.password"),
        role: t("users.form.role"),
        tariffId: t("users.form.tariff"),
        nodeId: t("users.form.node"),
      },
      ...options,
    });
  }
}
