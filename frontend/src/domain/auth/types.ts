export interface LoginInput {
  login: string;
  password: string;
  totp_code?: string;
}

export interface RegisterInput {
  email: string;
  login?: string;
  password: string;
}

export interface RegisterResult {
  status: "pending_email";
}

export interface VerifyEmailResult {
  status: "pending_approval" | "active";
}

export interface ForgotPasswordResult {
  status: "sent";
}

export interface ResetPasswordResult {
  status: "reset";
}

export interface TotpSetup {
  secret: string;
  otpauth_url: string;
  recovery_codes: string[];
}

export interface TotpToggleResult {
  enabled: boolean;
}

export interface AuthSessionInfo {
  jti: string;
  family_id: string;
  created_at: string;
  expires_at: string;
  revoked: boolean;
  used: boolean;
  user_agent: string | null;
  ip: string | null;
}

export interface LogoutAllResult {
  ok: boolean;
  revoked: number;
}
