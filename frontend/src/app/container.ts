import { HttpApi } from "@/infrastructure/http";
import { LocalTokenStore } from "@/infrastructure/storage";
import { LiveStats } from "@/infrastructure/stats";
import { Router } from "./router";
import { Session } from "./session";
import { ThemeStore } from "./theme";
import { ToastStore } from "./toast";

const tokens = new LocalTokenStore();

export const api = new HttpApi(tokens);
export const router = new Router();
export const session = new Session(api, tokens);
export const theme = new ThemeStore();
export const toasts = new ToastStore();
export const liveStats = new LiveStats(tokens);
export { tokens };
