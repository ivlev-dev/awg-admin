import type { ShareLinkState } from "@/domain/types";
import type { TranslationKey } from "@/i18n";

export type ForwardingMode = "off" | "all" | "selected";

export interface ForwardingRow {
  id: string;
  name: string;
  addresses: string[];
  mode: ForwardingMode;
  allowed: string[];
}

export interface ForwardingPair {
  aId: string;
  bId: string;
  label: string;
  allowed: boolean;
  detail: string;
  disabled: boolean;
}

export interface TunnelRow {
  readonly peerId: string;
  readonly label: string;
  readonly interfaceId: string;
  readonly interfaceName: string;
  readonly addresses: readonly string[];
  readonly endpoint: string;
  readonly publicKey: string;
  readonly primary: boolean;
}

export type TunnelSeed = Omit<TunnelRow, "primary">;

export interface Option {
  readonly value: string;
  readonly label: string;
}

export interface ClientEditState {
  readonly name: string;
  readonly downKbps: number;
  readonly upKbps: number;
  readonly forwardingMode: ForwardingMode;
  readonly forwardingSelected: readonly string[];
}

export const SHARE_STATE_KEYS: Record<ShareLinkState, TranslationKey> = {
  active: "clients.details.share.state.active",
  expired: "clients.details.share.state.expired",
  exhausted: "clients.details.share.state.exhausted",
  revoked: "clients.details.share.state.revoked",
};

export const SHARE_MAX_USES_LIMIT = 1000;
