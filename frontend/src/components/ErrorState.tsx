import { Icon } from "./Icon";
import { t } from "@/i18n";

export interface ErrorStateProps {
  readonly message: string;
  readonly onRetry?: () => void;
  readonly retryLabel?: string;
  readonly compact?: boolean;
}

export function ErrorState(props: ErrorStateProps): Node {
  return (
    <div class={`alert alert--error alert--with-action${props.compact ? " alert--compact" : ""}`}>
      <Icon name="warning" size={16} class="" />
      <span>{props.message}</span>
      {props.onRetry === undefined ? null : (
        <button class="btn btn--sm" type="button" onClick={() => props.onRetry?.()}>
          {props.retryLabel ?? t("common.retry")}
        </button>
      )}
    </div>
  );
}
