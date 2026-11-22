import {
  Field,
  Form,
  MaxLength,
  Optional,
  Required,
  ValidateIf,
} from "@ivlev-dev/silent-form";

import { PEER_LABEL_MAX } from "@/application/guards";
import { t } from "@/i18n";

export type TunnelFormMode = "add" | "rename";

export class TunnelForm extends Form {
  @Field()
  @ValidateIf((form: TunnelForm) => form.mode === "add")
  @Required({ message: () => t("clients.details.tunnels.interfaceRequired") })
  public accessor interfaceId: string = "";

  @Field()
  @Optional()
  @MaxLength(PEER_LABEL_MAX, {
    message: () => t("clients.details.tunnels.labelTooLong", { max: PEER_LABEL_MAX }),
  })
  public accessor addLabel: string = "";

  @Field()
  @ValidateIf((form: TunnelForm) => form.mode === "rename")
  @Required({ message: () => t("clients.details.tunnels.labelRequired") })
  @MaxLength(PEER_LABEL_MAX, {
    message: () => t("clients.details.tunnels.labelTooLong", { max: PEER_LABEL_MAX }),
  })
  public accessor renameLabel: string = "";

  /** Новый туннель допускает пустую метку, переименование — нет. */
  public mode: TunnelFormMode = "add";
}
