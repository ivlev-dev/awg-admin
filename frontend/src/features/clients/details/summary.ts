import { computed } from "@ivlev-dev/silent-core";

import { quotaDisplay, type QuotaDisplay } from "@/application/quota/display";
import type { QuotaUsageView } from "@/application/quota/service";
import type { DeviceStats } from "@/domain/devices/types";
import type { Device, Profile } from "@/domain/types";
import { t } from "@/i18n";
import { formatBytesI18n, formatRateI18n } from "@/i18n/format";

import { modeOfForwarding } from "./model";
import type { Option } from "./types";

type SummaryHost = {
  readonly device: Device | null;
  readonly stats: DeviceStats | null;
  readonly profiles: Profile[];
  readonly allDevices: Device[];
  readonly ownerQuota: QuotaUsageView | null;
};

export class ClientSummarySection {
  private host!: SummaryHost;

  attach(host: SummaryHost): void {
    this.host = host;
  }

  @computed
  get shareInterfaceOptions(): Option[] {
    const seen = new Set<string>();
    const options: Option[] = [];
    for (const profile of this.host.profiles) {
      if (seen.has(profile.interface_id)) continue;
      seen.add(profile.interface_id);
      options.push({ value: profile.interface_id, label: profile.interface_name });
    }
    return options;
  }

  @computed
  get addresses(): string[] {
    return this.host.device?.addresses ?? [];
  }

  @computed
  get interfaceLabel(): string {
    return this.host.device?.interface_name || "—";
  }

  @computed
  get nodeLabel(): string {
    return this.host.device?.node_name || "—";
  }

  @computed
  get downLabel(): string {
    return formatRateI18n(this.host.device?.down_kbps ?? 0);
  }

  @computed
  get upLabel(): string {
    return formatRateI18n(this.host.device?.up_kbps ?? 0);
  }

  @computed
  get forwardingLabel(): string {
    const forwarding = this.host.device?.forwarding;
    const mode = modeOfForwarding(forwarding);
    if (mode === "all") return t("clients.details.forwarding.all");
    if (mode === "selected") {
      return t("clients.details.forwarding.selected", {
        count: forwarding?.allowed_devices.length ?? 0,
      });
    }
    return t("clients.details.forwarding.none");
  }

  @computed
  get revoked(): boolean {
    return this.host.device?.revoked ?? false;
  }

  @computed
  get todayRx(): string {
    return formatBytesI18n(this.host.stats?.today.rx ?? 0);
  }

  @computed
  get todayTx(): string {
    return formatBytesI18n(this.host.stats?.today.tx ?? 0);
  }

  @computed
  get monthRx(): string {
    return formatBytesI18n(this.host.stats?.month.rx ?? 0);
  }

  @computed
  get monthTx(): string {
    return formatBytesI18n(this.host.stats?.month.tx ?? 0);
  }

  @computed
  get quotaView(): QuotaDisplay {
    return quotaDisplay(this.host.ownerQuota);
  }

  @computed
  get quotaExceeded(): boolean {
    return this.host.ownerQuota?.exceeded ?? false;
  }

  @computed
  get quotaUsageLabel(): string {
    if (!this.host.ownerQuota) return "";
    return t("clients.details.quotaUsage", {
      used: this.quotaView.usedLabel,
      limit: this.quotaView.limitLabel,
    });
  }

  @computed
  get rateLimitHint(): string {
    return this.quotaExceeded ? t("clients.details.rateLimit") : "";
  }

  @computed
  get otherDevices(): Device[] {
    const device = this.host.device;
    if (!device) return [];
    return this.host.allDevices.filter(
      (item) => item.user_id === device.user_id && item.id !== device.id && !item.revoked,
    );
  }
}
