import type { QuotaRepository } from "@/domain/quota/repository";
import type { QuotaState, QuotaUsage, UserQuota } from "@/domain/quota/types";

export interface QuotaUsageView {
  usedBytes: number;
  quotaBytes: number | null;
  exceeded: boolean;
  remainingBytes: number | null;
  percent: number | null;
}

export interface QuotaSnapshot extends QuotaUsageView {
  periodStart: string;
  periodEnd: string;
  resetAt: string;
}

export interface UserQuotaSnapshot extends QuotaUsageView {
  userId: string;
  login: string;
}

export interface QuotaService {
  me(): Promise<QuotaSnapshot>;
  users(): Promise<UserQuotaSnapshot[]>;
  forUser(userId: string): Promise<UserQuotaSnapshot | null>;
}

function toNonNegative(value: number): number {
  return Number.isFinite(value) && value > 0 ? value : 0;
}

function toQuotaLimit(value: number | null): number | null {
  return value !== null && Number.isFinite(value) && value > 0 ? value : null;
}

function clampPercent(value: number | null, usedBytes: number, quotaBytes: number): number {
  const raw = value !== null && Number.isFinite(value) ? value : (usedBytes / quotaBytes) * 100;
  return Math.min(100, Math.max(0, raw));
}

function normalizeUsage(usage: QuotaUsage): QuotaUsageView {
  const usedBytes = toNonNegative(usage.used_bytes);
  const quotaBytes = toQuotaLimit(usage.quota_bytes);
  const exceeded = quotaBytes !== null && (usage.exceeded || usedBytes >= quotaBytes);
  return {
    usedBytes,
    quotaBytes,
    exceeded,
    remainingBytes: quotaBytes === null ? null : Math.max(0, quotaBytes - usedBytes),
    percent: quotaBytes === null ? null : clampPercent(usage.percent, usedBytes, quotaBytes),
  };
}

function normalizeState(state: QuotaState): QuotaSnapshot {
  return {
    ...normalizeUsage(state),
    periodStart: state.period_start,
    periodEnd: state.period_end,
    resetAt: state.reset_at,
  };
}

function normalizeUserQuota(quota: UserQuota): UserQuotaSnapshot {
  return {
    ...normalizeUsage(quota),
    userId: quota.user_id,
    login: quota.login,
  };
}

export class DefaultQuotaService implements QuotaService {
  constructor(private readonly repository: QuotaRepository) {}

  async me(): Promise<QuotaSnapshot> {
    return normalizeState(await this.repository.me());
  }

  async users(): Promise<UserQuotaSnapshot[]> {
    const quotas = await this.repository.users();
    return quotas.map(normalizeUserQuota);
  }

  async forUser(userId: string): Promise<UserQuotaSnapshot | null> {
    const normalized = userId.trim();
    if (!normalized) return null;
    const quotas = await this.users();
    return quotas.find((quota) => quota.userId === normalized) ?? null;
  }
}
