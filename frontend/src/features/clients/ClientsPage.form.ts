import {
  ArrayNotEmpty,
  Custom,
  Field,
  Form,
  IsInt,
  MaxLength,
  Min,
  MinLength,
  Required,
  ValidateIf,
} from "@ivlev-dev/silent-form";

import { t } from "@/i18n";

export const DEVICE_NAME_MAX = 64;

function nonBlank(value: unknown): boolean {
  return typeof value === "string" && value.trim().length > 0;
}

function nameTooLong(): string {
  return t("clients.form.error.nameTooLong", { max: DEVICE_NAME_MAX });
}

function limitInt(): string {
  return t("clients.form.error.limitInt");
}

function limitMin(): string {
  return t("clients.form.error.limitMin");
}

export class CreateDeviceForm extends Form {
  @Field()
  @Required({ message: () => t("clients.details.error.name") })
  @MinLength(1, { message: () => t("clients.details.error.name") })
  @MaxLength(DEVICE_NAME_MAX, { message: nameTooLong })
  @Custom(nonBlank, { message: () => t("clients.details.error.name") })
  public accessor name: string = "";

  @Field()
  @ValidateIf((form: CreateDeviceForm) => form.adminMode)
  @Required({ message: () => t("clients.form.error.userRequired") })
  public accessor userId: string = "";

  @Field()
  @ValidateIf((form: CreateDeviceForm) => form.interfaceRequired)
  @ArrayNotEmpty({ message: () => t("clients.error.interface") })
  public accessor interfaceIds: string[] = [];

  @Field()
  @IsInt({ message: limitInt })
  @Min(0, { message: limitMin })
  public accessor downKbps: number = 0;

  @Field()
  @IsInt({ message: limitInt })
  @Min(0, { message: limitMin })
  public accessor upKbps: number = 0;

  @Field()
  public accessor forwarding: boolean = false;

  /** Форма используется и администратором, и обычным пользователем. */
  public adminMode: boolean = false;

  /** Требуется ли выбирать интерфейс в текущем окружении. */
  public interfaceRequired: boolean = false;
}
