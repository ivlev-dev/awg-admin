import type { Container } from "@ivlev-dev/silent-di";

import { DefaultAuditService } from "@/application/audit/service";
import { DefaultAuthService } from "@/application/auth/service";
import { DefaultDevicesService } from "@/application/devices/service";
import { DefaultGroupsService } from "@/application/groups/service";
import { DefaultImportService } from "@/application/import/service";
import { DefaultInterfacesService } from "@/application/interfaces/service";
import { DefaultNodesService } from "@/application/nodes/service";
import { DefaultQuotaService } from "@/application/quota/service";
import { DefaultSettingsService } from "@/application/settings/service";
import { DefaultStatsService } from "@/application/stats/service";
import { DefaultTariffsService } from "@/application/tariffs/service";
import { DefaultUsersService } from "@/application/users/service";
import { Router } from "@/app/router";
import { Session } from "@/app/session";
import { ThemeStore } from "@/app/theme";
import { ToastStore } from "@/app/toast";
import { DefaultApiConfig } from "@/infrastructure/http/config";
import { LiveStats } from "@/infrastructure/stats";
import { LocalTokenStore } from "@/infrastructure/storage";
import { t } from "@/i18n";
import { createAppServices } from "./di";

const router = new Router();
const theme = new ThemeStore();
const toasts = new ToastStore();
const services = createAppServices({
  onNetworkError: () => toasts.error(t("app.error.network")),
});
const liveStats = new LiveStats(services.tokens);

export function bindAppServices(container: Container): void {
  container.bind(LocalTokenStore, () => services.tokens);
  container.bind(DefaultApiConfig, () => services.config);
  container.bind(Session, () => services.session);
  container.bind(Router, () => router);
  container.bind(ThemeStore, () => theme);
  container.bind(ToastStore, () => toasts);
  container.bind(LiveStats, () => liveStats);
  container.bind(DefaultAuthService, () => services.auth);
  container.bind(DefaultAuditService, () => services.audit);
  container.bind(DefaultUsersService, () => services.users);
  container.bind(DefaultTariffsService, () => services.tariffs);
  container.bind(DefaultGroupsService, () => services.groups);
  container.bind(DefaultNodesService, () => services.nodes);
  container.bind(DefaultInterfacesService, () => services.interfaces);
  container.bind(DefaultDevicesService, () => services.devices);
  container.bind(DefaultStatsService, () => services.stats);
  container.bind(DefaultQuotaService, () => services.quota);
  container.bind(DefaultSettingsService, () => services.settings);
  container.bind(DefaultImportService, () => services.import);
}
