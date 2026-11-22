import {
  Field,
  Form,
  IsIn,
  IsInt,
  Max,
  Min,
  Optional,
  Required,
  ValidateIf,
} from "@ivlev-dev/silent-form";

import type { ShareFormat } from "@/domain/types";
import { t } from "@/i18n";

import { MAX_SHARE_USES } from "./types";

export const SHARE_TTL_VALUES = [3600, 86400, 604800] as const;
export const SHARE_FORMAT_VALUES: readonly ShareFormat[] = ["conf", "vpn"];

function maxUsesIsSet(form: ShareForm): boolean {
  if (form.oneTime || form.maxUsesEmpty) return false;
  const value = form.maxUses;
  return value !== "" && value !== null && value !== undefined;
}

export class ShareForm extends Form {
  @Field()
  @Required({ message: () => t("error.validation.shareTtl") })
  @IsIn(SHARE_TTL_VALUES, { message: () => t("error.validation.shareTtl") })
  public accessor ttl: number = 86400;

  @Field()
  @Optional()
  @ValidateIf(maxUsesIsSet)
  @IsInt({ message: () => t("clients.details.share.error.maxUsesInt") })
  @Min(1, {
    message: () => t("clients.details.share.error.maxUsesRange", { max: MAX_SHARE_USES }),
  })
  @Max(MAX_SHARE_USES, {
    message: () => t("clients.details.share.error.maxUsesRange", { max: MAX_SHARE_USES }),
  })
  public accessor maxUses: number | string = 0;

  /** Пустая строка в поле означает «без лимита». */
  public maxUsesEmpty: boolean = true;

  @Field()
  @IsIn(SHARE_FORMAT_VALUES, { message: () => t("clients.details.share.error.format") })
  public accessor format: ShareFormat = "conf";

  @Field()
  public accessor oneTime: boolean = false;
}
