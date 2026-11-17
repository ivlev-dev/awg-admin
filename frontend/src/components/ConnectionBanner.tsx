import { Show } from "@ivlev-dev/silent-core";

import type { ConnectionNotice } from "@/app/connection";
import { Icon } from "./Icon";
import { t } from "@/i18n";

export interface ConnectionBannerProps {
  readonly notice: () => ConnectionNotice;
  readonly online: () => boolean;
}

export function ConnectionBanner(props: ConnectionBannerProps): Node {
  return (
    <Show when={props.notice()}>
      <div class={`connection-banner ${props.online() ? "connection-banner--restored" : "connection-banner--offline"}`} role="status">
        <Icon name={props.online() ? "check" : "warning"} size={16} class="" />
        <span class="connection-banner__text">
          {props.online() ? t("app.network.restored") : t("app.network.offline")}
        </span>
        <Show when={!props.online()}>
          <span class="connection-banner__hint">{t("app.network.offlineHint")}</span>
        </Show>
      </div>
    </Show>
  );
}
