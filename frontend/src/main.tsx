import { container as rootContainer } from "@ivlev-dev/silent-di";
import { mount } from "@ivlev-dev/silent-core";
import "./styles/index.css";
import { App } from "./app/App";
import { bindAppServices } from "./app/container";

bindAppServices(rootContainer);

void mount("#app", App, { container: rootContainer });
