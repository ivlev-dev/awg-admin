import { Custom, Field, Form, MaxLength, Required } from "@ivlev-dev/silent-form";

import { FULL_NAME_MAX } from "@/application/guards";
import { t } from "@/i18n";

function characterLength(value: unknown): number {
  return [...String(value).trim()].length;
}

export class FullNameForm extends Form {
  @Field()
  @Required({ message: () => t("error.validation.fullNameRequired") })
  @MaxLength(FULL_NAME_MAX, {
    message: () => t("profile.fullName.error.tooLong", { max: FULL_NAME_MAX }),
  })
  @Custom(
    (value) => characterLength(value) <= FULL_NAME_MAX,
    {
      message: () => t("profile.fullName.error.tooLong", { max: FULL_NAME_MAX }),
      when: (form: object) => (form as FullNameForm).fullName.trim().length > 0,
    },
  )
  public accessor fullName: string = "";

  constructor(fullName: string = "") {
    super({ formId: "profile-full-name", validateOnInput: true });
    this.fullName = fullName;
  }
}
