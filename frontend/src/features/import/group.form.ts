import {
  Custom,
  Field,
  Form,
  Matches,
  MaxLength,
  Optional,
  Required,
} from "@ivlev-dev/silent-form";

import { isCidr } from "@/domain/validation";
import { t } from "@/i18n";

import { DEFAULT_BASE_CIDR } from "./drafts";

export const GROUP_NAME_MAX_LENGTH = 120;
export const GROUP_DESCRIPTION_MAX_LENGTH = 500;
export const BASE_CIDR_PATTERN = /^(?:\d{1,3}\.){3}\d{1,3}\/\d{1,2}$/;

const groupNameMessage = (): string => t("import.error.groupName");
const groupNameLengthMessage = (): string =>
  t("import.error.groupNameLength", { max: GROUP_NAME_MAX_LENGTH });
const groupDescriptionLengthMessage = (): string =>
  t("import.error.groupDescriptionLength", { max: GROUP_DESCRIPTION_MAX_LENGTH });
const baseCidrMessage = (): string => t("import.error.baseCidr");
const nodeMessage = (): string => t("import.error.node");

/** Имя группы не может состоять из одних пробелов. */
export function hasGroupNameContent(value: unknown): boolean {
  return typeof value === "string" && value.trim().length > 0;
}

/** CIDR IPv4 с октетами ≤ 255 и префиксом ≤ 32. */
export function isBaseCidr(value: unknown): boolean {
  return typeof value === "string" && isCidr(value);
}

export class GroupImportForm extends Form {
  @Field()
  @Required({ message: groupNameMessage })
  @Custom(hasGroupNameContent, { message: groupNameMessage })
  @MaxLength(GROUP_NAME_MAX_LENGTH, { message: groupNameLengthMessage })
  public accessor groupName: string = "";

  @Field()
  @Optional()
  @MaxLength(GROUP_DESCRIPTION_MAX_LENGTH, { message: groupDescriptionLengthMessage })
  public accessor groupDescription: string = "";

  @Field()
  @Required({ message: baseCidrMessage })
  @Matches(BASE_CIDR_PATTERN, { message: baseCidrMessage })
  @Custom(isBaseCidr, { message: baseCidrMessage })
  public accessor baseCidr: string = DEFAULT_BASE_CIDR;

  @Field()
  @Required({ message: nodeMessage })
  public accessor nodeId: string = "";

  @Field()
  @Optional()
  public accessor ownerUserId: string = "";

  constructor() {
    super({ formId: "import-group", validateOnInput: true });
  }
}
