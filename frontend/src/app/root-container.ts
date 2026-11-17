import { Container } from "@ivlev-dev/silent-di";

export const rootContainer = new Container("awg-admin", undefined, { implicitBindings: "warn" });
