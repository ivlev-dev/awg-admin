import { container as rootContainer } from "@ivlev-dev/silent-di";
import { mount } from "@ivlev-dev/silent-core";
import "./styles/index.css";
import { App } from "./app/App";
import { bindAppServices } from "./app/container";
import { installGlobalErrorHandler } from "./app/errors";
import { ToastStore } from "./app/toast";

bindAppServices(rootContainer);

installGlobalErrorHandler(await rootContainer.resolve<ToastStore>(ToastStore));

await mount("#app", App, { container: rootContainer });
