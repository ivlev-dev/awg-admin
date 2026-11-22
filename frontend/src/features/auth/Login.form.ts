import {
  Field,
  Form,
  Matches,
  Optional,
  Required,
  ValidateIf,
} from "@ivlev-dev/silent-form";

import { t } from "@/i18n";

/** Бэкенд допускает `admin@local`, поэтому TLD не требуется. */
export const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+$/;

export const TOTP_PATTERN = /^(?:\d{6}|[A-Za-z0-9-]{6,})$/;

export class LoginForm extends Form {
  @Field()
  @Required({ message: () => t("auth.register.error.email") })
  @Matches(EMAIL_PATTERN, { message: () => t("auth.register.error.email") })
  public accessor email: string = "";

  @Field()
  @Required()
  public accessor password: string = "";

  @Field()
  @Optional()
  @ValidateIf((form: LoginForm) => form.totpRequired)
  @Required({ message: () => t("auth.login.error.totpInvalid") })
  @Matches(TOTP_PATTERN, {
    message: () => t("auth.login.error.totpInvalid"),
    when: (form: object) => (form as LoginForm).totpCode.length > 0,
  })
  public accessor totpCode: string = "";

  /** Включается, когда сервер запросил второй фактор. */
  public totpRequired: boolean = false;

  constructor() {
    super({ formId: "login", validateOnInput: true });
  }
}
