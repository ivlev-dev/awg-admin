export interface QuotaUsage {
  used_bytes: number;
  quota_bytes: number | null;
  exceeded: boolean;
  percent: number | null;
}

export interface QuotaState extends QuotaUsage {
  remaining_bytes: number | null;
  period_start: string;
  period_end: string;
  reset_at: string;
}

export interface UserQuota extends QuotaUsage {
  user_id: string;
  login: string;
}
