import { container as rootContainer } from "@ivlev-dev/silent-di";
import { mount } from "@ivlev-dev/silent-core";
import "./styles/index.css";
import { App } from "./app/App";
import { bindAppServices } from "./app/container";
import { loadPage, type PageName } from "./app/page-loaders";
import { setPageLoader } from "./app/router-records";
import { installGlobalErrorHandler } from "./app/errors";
import { ToastStore } from "./app/toast";

setPageLoader((name) => loadPage(name as PageName));
bindAppServices(rootContainer);

installGlobalErrorHandler(await rootContainer.resolve<ToastStore>(ToastStore));

await mount("#app", App, { container: rootContainer });
