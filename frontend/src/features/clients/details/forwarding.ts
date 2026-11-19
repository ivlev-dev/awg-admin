import { computed, reactive } from "@ivlev-dev/silent-core";

import type { DevicesService } from "@/application/devices/service";
import { userMessage } from "@/application/errors";
import type { ToastStore } from "@/app/toast";
import type { Device, Forwarding } from "@/domain/types";
import { t } from "@/i18n";

import {
  FORWARDING_MODE_KEYS,
  FORWARDING_MODES,
  forwardingPayload,
  modeOfForwarding,
  parseForwardingMode,
} from "./model";
import type { ForwardingMode, ForwardingPair, ForwardingRow } from "./types";

type ForwardingHost = {
  readonly device: Device | null;
  readonly allDevices: Device[];
  readonly devicesService: DevicesService;
  readonly toasts: ToastStore;
  setDevice(device: Device): void;
  applyFormForwarding(mode: ForwardingMode, allowed: readonly string[]): void;
  refreshSnapshotForwarding(mode: ForwardingMode, allowed: readonly string[]): void;
}

export class ForwardingSection {
  private host!: ForwardingHost;

  attach(host: ForwardingHost): void {
    this.host = host;
  }

  @reactive accessor rows: ForwardingRow[] = [];
  @reactive accessor symmetric = true;
  @reactive accessor busy = false;

  @computed
  get modeOptions(): Array<{ value: ForwardingMode; label: string; hint?: string }> {
    return FORWARDING_MODES.map((value) => ({
      value,
      label: t(FORWARDING_MODE_KEYS[value]),
      ...(value === "all" ? { hint: t("clients.details.forwarding.mode.allHint") } : {}),
    }));
  }

  @computed
  get bulk(): boolean {
    return this.rows.some((row) => row.mode === "all");
  }

  @computed
  get matrixReady(): boolean {
    return this.rows.length > 1;
  }

  @computed
  get pairs(): ForwardingPair[] {
    const rows = this.rows;
    const pairs: ForwardingPair[] = [];
    for (let i = 0; i < rows.length; i += 1) {
      const a = rows[i];
      if (!a) continue;
      for (let j = i + 1; j < rows.length; j += 1) {
        const b = rows[j];
        if (!b) continue;
        const forward = this.rowAllows(a, b.id);
        const backward = this.rowAllows(b, a.id);
        const label = `${a.name} ↔ ${b.name}`;
        const detail = forward && backward
          ? t("clients.details.forwarding.pairAllowed")
          : forward
            ? t("clients.details.forwarding.pairOnly", { from: a.name, to: b.name })
            : backward
              ? t("clients.details.forwarding.pairOnly", { from: b.name, to: a.name })
              : t("clients.details.forwarding.pairDenied");
        pairs.push({
          aId: a.id,
          bId: b.id,
          label,
          allowed: forward && backward,
          detail,
          disabled: this.busy || a.mode === "all" || b.mode === "all",
        });
      }
    }
    return pairs;
  }

  setSymmetric(event: Event): void {
    this.symmetric = (event.target as HTMLInputElement).checked;
  }

  isCellChecked(rowId: string, targetId: string): boolean {
    const row = this.findRow(rowId);
    return row ? this.rowAllows(row, targetId) : false;
  }

  isCellDisabled(rowId: string, targetId: string): boolean {
    if (this.busy || rowId === targetId) return true;
    const row = this.findRow(rowId);
    return !row || row.mode !== "selected";
  }

  pairTitle(rowId: string, targetId: string): string {
    const row = this.findRow(rowId);
    const target = this.findRow(targetId);
    if (!row || !target || row.id === target.id) return "";
    const pair = this.symmetric
      ? `${row.name} ↔ ${target.name}`
      : `${row.name} → ${target.name}`;
    const state = this.rowAllows(row, target.id)
      ? t("clients.details.forwarding.pairAllowed")
      : t("clients.details.forwarding.pairDenied");
    return `${pair}: ${state}`;
  }

  async setRowMode(rowId: string, value: string): Promise<void> {
    if (this.busy) return;
    const row = this.findRow(rowId);
    const mode = parseForwardingMode(value);
    if (!row || row.mode === mode) return;
    const snapshot = this.snapshotRows();
    const next: ForwardingRow =
      mode === "off"
        ? { ...row, mode, allowed: [] }
        : { ...row, mode };
    this.replaceRow(next);
    if (mode === "selected" && next.allowed.length === 0) return;
    await this.persistRows(
      [{ rowId: next.id, forwarding: forwardingPayload(next.mode, next.allowed) }],
      snapshot,
    );
  }

  async toggleCell(rowId: string, targetId: string): Promise<void> {
    if (this.busy || rowId === targetId) return;
    const row = this.findRow(rowId);
    const target = this.findRow(targetId);
    if (!row || !target || row.mode !== "selected") return;
    const snapshot = this.snapshotRows();
    const grant = !row.allowed.includes(targetId);
    const nextRow = this.rowWithAllowed(row, grant ? [...row.allowed, targetId] : row.allowed.filter((id) => id !== targetId));
    this.replaceRow(nextRow);
    const changes: Array<{ rowId: string; forwarding: Forwarding }> = [
      { rowId: nextRow.id, forwarding: forwardingPayload(nextRow.mode, nextRow.allowed) },
    ];
    if (this.symmetric && target.mode !== "all") {
      const mirrorAllowed = grant
        ? [...target.allowed, rowId]
        : target.allowed.filter((id) => id !== rowId);
      if (target.mode === "selected" || grant) {
        const nextTarget = this.rowWithAllowed(target, mirrorAllowed);
        this.replaceRow(nextTarget);
        changes.push({
          rowId: nextTarget.id,
          forwarding: forwardingPayload(nextTarget.mode, nextTarget.allowed),
        });
      }
    }
    await this.persistRows(changes, snapshot);
  }

  async togglePair(aId: string, bId: string): Promise<void> {
    if (this.busy || aId === bId) return;
    const a = this.findRow(aId);
    const b = this.findRow(bId);
    if (!a || !b) return;
    if (a.mode === "all" || b.mode === "all") {
      this.host.toasts.error(t("clients.details.forwarding.bulkError"));
      return;
    }
    const snapshot = this.snapshotRows();
    const bothAllowed = this.rowAllows(a, bId) && this.rowAllows(b, aId);
    const nextA = this.rowWithAllowed(
      a,
      bothAllowed ? a.allowed.filter((id) => id !== bId) : [...a.allowed, bId],
    );
    const nextB = this.rowWithAllowed(
      b,
      bothAllowed ? b.allowed.filter((id) => id !== aId) : [...b.allowed, aId],
    );
    this.replaceRow(nextA);
    this.replaceRow(nextB);
    await this.persistRows(
      [
        { rowId: nextA.id, forwarding: forwardingPayload(nextA.mode, nextA.allowed) },
        { rowId: nextB.id, forwarding: forwardingPayload(nextB.mode, nextB.allowed) },
      ],
      snapshot,
    );
  }

  buildRows(device: Device): void {
    this.rows = this.host.allDevices
      .filter((item) => item.user_id === device.user_id && !item.revoked)
      .map((item) => {
        const mode = modeOfForwarding(item.forwarding);
        return {
          id: item.id,
          name: item.name,
          addresses: [...item.addresses],
          mode,
          allowed: mode === "selected" ? this.orderedAllowed(item.forwarding.allowed_devices) : [],
        };
      });
  }

  applyRowFromDevice(device: Device): void {
    const mode = modeOfForwarding(device.forwarding);
    const exists = this.rows.some((row) => row.id === device.id);
    if (!exists) return;
    this.rows = this.rows.map((row) =>
      row.id === device.id
        ? {
            id: row.id,
            name: device.name,
            addresses: [...device.addresses],
            mode,
            allowed: mode === "selected" ? this.orderedAllowed(device.forwarding.allowed_devices) : [],
          }
        : row,
    );
    if (this.host.device?.id === device.id) {
      this.host.setDevice({ ...this.host.device, name: device.name, forwarding: device.forwarding });
      this.syncFormForwarding();
    }
  }

  orderedAllowed(ids: readonly string[]): string[] {
    const order = new Map(this.rows.map((row, index) => [row.id, index]));
    return [...ids].sort(
      (a, b) => (order.get(a) ?? Number.MAX_SAFE_INTEGER) - (order.get(b) ?? Number.MAX_SAFE_INTEGER),
    );
  }

  private syncFormForwarding(): void {
    const device = this.host.device;
    if (!device) return;
    const row = this.findRow(device.id);
    if (!row) return;
    this.host.applyFormForwarding(row.mode, [...row.allowed]);
    this.host.refreshSnapshotForwarding(row.mode, [...row.allowed]);
  }

  private findRow(rowId: string): ForwardingRow | undefined {
    return this.rows.find((row) => row.id === rowId);
  }

  private rowAllows(row: ForwardingRow, targetId: string): boolean {
    if (row.id === targetId) return false;
    if (row.mode === "all") return true;
    return row.mode === "selected" && row.allowed.includes(targetId);
  }

  private rowWithAllowed(row: ForwardingRow, allowed: string[]): ForwardingRow {
    const unique = this.orderedAllowed(Array.from(new Set(allowed)));
    return { ...row, allowed: unique, mode: unique.length > 0 ? "selected" : "off" };
  }

  private snapshotRows(): ForwardingRow[] {
    return this.rows.map((row) => ({ ...row, addresses: [...row.addresses], allowed: [...row.allowed] }));
  }

  private replaceRow(next: ForwardingRow): void {
    this.rows = this.rows.map((row) => (row.id === next.id ? next : row));
    if (this.host.device?.id === next.id) this.syncFormForwarding();
  }

  private async persistRows(
    changes: Array<{ rowId: string; forwarding: Forwarding }>,
    snapshot: ForwardingRow[],
  ): Promise<void> {
    if (changes.length === 0) return;
    this.busy = true;
    try {
      for (let index = 0; index < changes.length; index += 1) {
        const change = changes[index];
        if (!change) continue;
        try {
          const updated = await this.host.devicesService.updateDevice(change.rowId, {
            forwarding: change.forwarding,
          });
          this.applyRowFromDevice(updated);
        } catch (error) {
          const failed = changes.slice(index).map((item) => item.rowId);
          this.restoreRows(snapshot, failed);
          this.host.toasts.error(userMessage(error, t("clients.details.error.forwarding")));
          return;
        }
      }
    } finally {
      this.busy = false;
    }
  }

  private restoreRows(snapshot: ForwardingRow[], rowIds: string[]): void {
    this.rows = this.rows.map((row) => {
      if (!rowIds.includes(row.id)) return row;
      const previous = snapshot.find((item) => item.id === row.id);
      return previous ? { ...previous, addresses: [...previous.addresses], allowed: [...previous.allowed] } : row;
    });
    if (this.host.device && rowIds.includes(this.host.device.id)) this.syncFormForwarding();
  }
}
