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

export interface TotpSetup {
  secret: string;
  otpauth_url: string;
  recovery_codes: string[];
}

export interface TotpToggleResult {
  enabled: boolean;
}
