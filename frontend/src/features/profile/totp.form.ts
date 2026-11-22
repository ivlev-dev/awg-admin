import { Field, Form, Matches, Required } from "@ivlev-dev/silent-form";

import { t } from "@/i18n";

export const TOTP_CODE_PATTERN = /^\d{6}$/;

export class TotpSetupForm extends Form {
  @Field()
  @Required({ message: () => t("profile.totp.error.passwordRequired") })
  public accessor password: string = "";

  constructor() {
    super({ formId: "profile-totp-setup", validateOnInput: true });
  }
}

export class TotpEnableForm extends Form {
  @Field()
  @Required({ message: () => t("profile.totp.error.passwordRequired") })
  public accessor password: string = "";

  @Field()
  @Required({ message: () => t("profile.totp.error.invalidCode") })
  @Matches(TOTP_CODE_PATTERN, {
    message: () => t("profile.totp.error.invalidCode"),
  })
  public accessor code: string = "";

  constructor() {
    super({ formId: "profile-totp-enable", validateOnInput: true });
  }
}

export class TotpDisableForm extends Form {
  @Field()
  @Required({ message: () => t("profile.totp.error.passwordRequired") })
  public accessor password: string = "";

  @Field()
  @Required({ message: () => t("profile.totp.error.invalidCode") })
  @Matches(TOTP_CODE_PATTERN, {
    message: () => t("profile.totp.error.invalidCode"),
  })
  public accessor code: string = "";

  constructor() {
    super({ formId: "profile-totp-disable", validateOnInput: true });
  }
}
