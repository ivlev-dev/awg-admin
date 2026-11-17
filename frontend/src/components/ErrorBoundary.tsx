import { ErrorBoundary } from "@ivlev-dev/silent-core";

import { Icon } from "./Icon";
import { t } from "@/i18n";

export interface AppErrorBoundaryProps {
  readonly onHome: () => void;
  readonly children: () => unknown;
}

export interface AppErrorFallbackProps {
  readonly error: unknown;
  readonly reset: () => void;
  readonly onHome: () => void;
}

export function AppErrorFallback(props: AppErrorFallbackProps): Node {
  const detail = props.error instanceof Error ? props.error.message : "";
  return (
    <div class="state-screen" role="alert">
      <div class="state-screen__icon">
        <Icon name="warning" size={28} class="" />
      </div>
      <h1>{t("app.error.boundary.title")}</h1>
      <p class="muted">{t("app.error.boundary.text")}</p>
      <div class="state-screen__actions">
        <button class="btn btn--primary" type="button" onClick={() => window.location.reload()}>
          {t("app.action.reload")}
        </button>
        <button
          class="btn"
          type="button"
          onClick={() => {
            props.onHome();
            props.reset();
          }}
        >
          {t("app.action.home")}
        </button>
      </div>
      {detail ? <div class="xs muted state-screen__detail">{detail}</div> : null}
    </div>
  );
}

export function AppErrorBoundary(props: AppErrorBoundaryProps): Node {
  return (
    <ErrorBoundary
      fallback={(error: unknown, reset: () => void) => {
        console.error("Ошибка интерфейса", error);
        return <AppErrorFallback error={error} reset={reset} onHome={props.onHome} />;
      }}
    >
      {() => props.children()}
    </ErrorBoundary>
  );
}
