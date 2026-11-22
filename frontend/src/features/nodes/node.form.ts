import { Custom, Field, Form, MaxLength, Required } from "@ivlev-dev/silent-form";

import { t } from "@/i18n";

export const NODE_NAME_MAX_LENGTH = 64;

const nameMessage = (): string => t("nodes.error.name");
const nameLengthMessage = (): string => t("nodes.error.nameLength");

/** Имя ноды не может состоять из одних пробелов. */
export function hasNodeNameContent(value: unknown): boolean {
  return String(value ?? "").trim().length > 0;
}

export class NodeForm extends Form {
  @Field()
  @Required({ message: nameMessage })
  @Custom(hasNodeNameContent, { message: nameMessage })
  @MaxLength(NODE_NAME_MAX_LENGTH, { message: nameLengthMessage })
  public accessor name: string = "";

  constructor() {
    super({ formId: "node-create", validateOnInput: true });
  }
}
