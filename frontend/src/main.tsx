import { mount } from "@ivlev-dev/silent-core";
import "./styles/index.css";
import { App } from "./app/App";
import { appRouter, bindAppServices } from "./app/container";
import { isPageName, loadPage } from "./app/page-loaders";
import { setPageLoader } from "./app/router-records";
import { rootContainer } from "./app/root-container";
import { installGlobalErrorHandler } from "./app/errors";
import { ToastStore } from "./app/toast";

setPageLoader((name) => {
  if (!isPageName(name)) return Promise.reject(new Error(`unknown page: ${name}`));
  return loadPage(name);
});
bindAppServices(rootContainer);

installGlobalErrorHandler(await rootContainer.resolve<ToastStore>(ToastStore));

await appRouter.start();

await mount("#app", App, { container: rootContainer });
