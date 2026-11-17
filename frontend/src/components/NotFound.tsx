import { Icon } from "./Icon";
import { t } from "@/i18n";

export interface NotFoundProps {
  readonly path: string;
  readonly onHome: () => void;
  readonly standalone?: boolean;
}

export function NotFound(props: NotFoundProps): Node {
  return (
    <div class={`state-screen ${props.standalone ? "state-screen--standalone" : ""}`}>
      <div class="state-screen__code">404</div>
      <h1>{t("app.notFound.title")}</h1>
      <p class="muted">{t("app.notFound.text", { path: props.path })}</p>
      <a
        class="btn btn--primary"
        href="/"
        onClick={(event: Event) => {
          event.preventDefault();
          props.onHome();
        }}
      >
        <Icon name="overview" size={16} class="" />
        {t("app.action.home")}
      </a>
    </div>
  );
}
