import {
  Custom,
  Field,
  Form,
  IsInt,
  Matches,
  Max,
  MaxLength,
  Min,
  Optional,
  Required,
} from "@ivlev-dev/silent-form";
import type { FieldPath, ValidationOptions } from "@ivlev-dev/silent-form";

import { t } from "@/i18n";

export const INTERFACE_NAME_MAX_LENGTH = 15;
export const INTERFACE_LABEL_MAX_LENGTH = 64;
export const INTERFACE_MTU_MIN = 576;
export const INTERFACE_MTU_MAX = 65535;
export const INTERFACE_NAME_PATTERN = /^\s*[A-Za-z0-9_-]+\s*$/;

const nameMessage = (): string => t("interfaces.error.name");
const nameLengthMessage = (): string => t("interfaces.error.nameLength");
const groupMessage = (): string => t("interfaces.error.group");
const nodeMessage = (): string => t("interfaces.error.node");
const labelMessage = (): string => t("interfaces.error.label");
const hostMessage = (): string => t("interfaces.error.host");
const portMessage = (): string => t("interfaces.error.port");
const mtuMessage = (): string => t("interfaces.error.mtu");

function asText(value: unknown): string {
  return typeof value === "string" ? value : String(value ?? "");
}

/**
 * Числовые поля получают строку из пустого input, поэтому типы проверяем
 * явными правилами (`@IsInt`/`@Min`/`@Max`) с локализованными сообщениями,
 * а не схемой плагина `validation()`.
 */
function withoutTypeChecks(options?: ValidationOptions): ValidationOptions {
  return { ...options, types: false };
}

/** Длина имени интерфейса укладывается в ограничение бэкенда (до 15 символов). */
export function fitsInterfaceName(value: unknown): boolean {
  return asText(value).trim().length <= INTERFACE_NAME_MAX_LENGTH;
}

/**
 * Host валиден, если после обрезки он непустой и не содержит пробельных символов.
 * Проверка совпадает с прежним поведением формы (IPv4, IPv6 и доменные имена).
 */
export function isEndpointHost(value: unknown): boolean {
  const host = asText(value).trim();
  return host.length > 0 && !/\s/.test(host);
}

export class InterfaceForm extends Form {
  @Field()
  @Required({ message: groupMessage })
  public accessor groupId: string = "";

  @Field()
  @Required({ message: nodeMessage })
  public accessor nodeId: string = "";

  @Field()
  @Required({ message: nameMessage })
  @Matches(INTERFACE_NAME_PATTERN, { message: nameMessage })
  @Custom(fitsInterfaceName, { message: nameLengthMessage })
  public accessor name: string = "";

  @Field()
  @Optional()
  @MaxLength(INTERFACE_LABEL_MAX_LENGTH, { message: labelMessage })
  public accessor label: string = "";

  @Field()
  @Required({ message: hostMessage })
  @Custom(isEndpointHost, { message: hostMessage })
  public accessor endpointHost: string = "";

  @Field()
  @Required({ message: portMessage })
  @IsInt({ message: portMessage })
  @Min(1, { message: portMessage })
  @Max(65535, { message: portMessage })
  public accessor endpointPort: number = 443;

  @Field()
  @Required({ message: portMessage })
  @IsInt({ message: portMessage })
  @Min(1, { message: portMessage })
  @Max(65535, { message: portMessage })
  public accessor listenPort: number = 51820;

  @Field()
  @Required({ message: mtuMessage })
  @IsInt({ message: mtuMessage })
  @Min(INTERFACE_MTU_MIN, { message: mtuMessage })
  @Max(INTERFACE_MTU_MAX, { message: mtuMessage })
  public accessor mtu: number = 1420;

  constructor() {
    super({ formId: "interface-create", validateOnInput: true });
  }

  override validate(options?: ValidationOptions): Promise<boolean> {
    return super.validate(withoutTypeChecks(options));
  }

  override validateField(field: FieldPath<this>, options?: ValidationOptions): Promise<boolean> {
    return super.validateField(field, withoutTypeChecks(options));
  }
}

export class InterfaceEditForm extends Form {
  @Field()
  @Optional()
  @MaxLength(INTERFACE_LABEL_MAX_LENGTH, { message: labelMessage })
  public accessor label: string = "";

  @Field()
  @Required({ message: hostMessage })
  @Custom(isEndpointHost, { message: hostMessage })
  public accessor endpointHost: string = "";

  @Field()
  @Required({ message: portMessage })
  @IsInt({ message: portMessage })
  @Min(1, { message: portMessage })
  @Max(65535, { message: portMessage })
  public accessor endpointPort: number = 443;

  @Field()
  @Required({ message: portMessage })
  @IsInt({ message: portMessage })
  @Min(1, { message: portMessage })
  @Max(65535, { message: portMessage })
  public accessor listenPort: number = 51820;

  @Field()
  @Required({ message: mtuMessage })
  @IsInt({ message: mtuMessage })
  @Min(INTERFACE_MTU_MIN, { message: mtuMessage })
  @Max(INTERFACE_MTU_MAX, { message: mtuMessage })
  public accessor mtu: number = 1420;

  @Field()
  public accessor enabled: boolean = true;

  constructor() {
    super({ formId: "interface-edit", validateOnInput: true });
  }

  override validate(options?: ValidationOptions): Promise<boolean> {
    return super.validate(withoutTypeChecks(options));
  }

  override validateField(field: FieldPath<this>, options?: ValidationOptions): Promise<boolean> {
    return super.validateField(field, withoutTypeChecks(options));
  }
}
