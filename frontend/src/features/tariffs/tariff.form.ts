import { Field, Form, Optional, Required, ValidateIf } from "@ivlev-dev/silent-form";
import { IsInt, IsNumber, Max, MaxLength, Min } from "@ivlev-dev/silent-validation";

import { t } from "@/i18n";

const NAME_MAX_LENGTH = 120;
const DESCRIPTION_MAX_LENGTH = 500;
const MAX_DEVICES_LIMIT = 1000;

export class TariffForm extends Form {
  @Field()
  @Required({ message: () => t("error.validation.tariffName") })
  @MaxLength(NAME_MAX_LENGTH)
  public accessor name: string = "";

  @Field()
  @Optional()
  @MaxLength(DESCRIPTION_MAX_LENGTH)
  public accessor description: string = "";

  @Field()
  @IsInt()
  @Min(1)
  @Max(MAX_DEVICES_LIMIT)
  public accessor maxDevices: number = 1;

  @Field()
  @IsInt()
  @Min(0)
  public accessor deviceDownKbps: number = 0;

  @Field()
  @IsInt()
  @Min(0)
  public accessor deviceUpKbps: number = 0;

  @Field()
  @IsInt()
  @Min(0)
  public accessor groupDownKbps: number = 0;

  @Field()
  @IsInt()
  @Min(0)
  public accessor groupUpKbps: number = 0;

  /** `0` — без ограничения; пустое значение тоже означает безлимит. */
  @Field()
  @Optional()
  @ValidateIf((form: TariffForm) => String(form.quotaGb).trim() !== "")
  @IsNumber()
  @Min(0)
  public accessor quotaGb: number = 0;

  @Field()
  @Optional()
  public accessor interfaceId: string = "";

  constructor(options: ConstructorParameters<typeof Form>[0] = {}) {
    super({
      formId: "tariffs-form",
      labels: {
        name: t("tariffs.form.name"),
        description: t("tariffs.form.description"),
        maxDevices: t("tariffs.form.maxDevices"),
        deviceDownKbps: t("tariffs.form.deviceDown"),
        deviceUpKbps: t("tariffs.form.deviceUp"),
        groupDownKbps: t("tariffs.form.groupDown"),
        groupUpKbps: t("tariffs.form.groupUp"),
        quotaGb: t("tariffs.form.quota"),
        interfaceId: t("tariffs.form.interface"),
      },
      ...options,
    });
  }
}
