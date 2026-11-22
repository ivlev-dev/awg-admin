import {
  Custom,
  Field,
  Form,
  Optional,
  Required,
} from "@ivlev-dev/silent-form";

import { splitClientConfigs } from "@/domain/import/validation";
import { t } from "@/i18n";

const clientsMessage = (): string => t("import.error.clientsText");

/** Текст должен разбираться хотя бы в один конфиг устройства. */
export function parsesClients(value: unknown): boolean {
  return typeof value === "string" && splitClientConfigs(value).length > 0;
}

export class ClientsImportForm extends Form {
  /** Пустое значение — текущий администратор (бэкенд подставляет его сам). */
  @Field()
  @Optional()
  public accessor clientOwnerUserId: string = "";

  /** Пустое значение — автоопределение интерфейса по PublicKey. */
  @Field()
  @Optional()
  public accessor clientInterfaceId: string = "";

  @Field()
  @Required({ message: clientsMessage })
  @Custom(parsesClients, { message: clientsMessage })
  public accessor clientsImportText: string = "";

  constructor() {
    super({ formId: "import-clients", validateOnInput: true });
  }
}
