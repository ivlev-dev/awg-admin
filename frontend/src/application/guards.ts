import type { TranslationKey } from "@/i18n";

import { ValidationError } from "./errors";

export function requireId(value: string, label: TranslationKey): string {
  const trimmed = value.trim();
  if (!trimmed) throw new ValidationError("error.validation.idRequired", { label });
  return trimmed;
}

export function requireText(value: string, label: TranslationKey): string {
  const trimmed = value.trim();
  if (!trimmed) throw new ValidationError("error.validation.textRequired", { label });
  return trimmed;
}

export const PEER_LABEL_MAX = 64;

export function requirePeerLabel(
  value: string,
  label: TranslationKey = "error.label.tunnelLabel",
): string {
  const trimmed = value.trim();
  if (!trimmed) throw new ValidationError("error.validation.peerLabelRequired", { label });
  if (trimmed.length > PEER_LABEL_MAX) {
    throw new ValidationError("error.validation.peerLabelTooLong", {
      label,
      max: PEER_LABEL_MAX,
    });
  }
  return trimmed;
}

export function requirePort(value: number, label: TranslationKey): number {
  if (!Number.isInteger(value) || value < 1 || value > 65_535) {
    throw new ValidationError("error.validation.portRange", { label });
  }
  return value;
}

export function requireMtu(value: number): number {
  if (!Number.isInteger(value) || value < 576 || value > 65_535) {
    throw new ValidationError("error.validation.mtuRange");
  }
  return value;
}

export function requireRate(value: number, label: TranslationKey): number {
  if (!Number.isFinite(value) || value < 0) {
    throw new ValidationError("error.validation.rateNegative", { label });
  }
  return Math.trunc(value);
}

export function validatePassword(value: string): string {
  if (value.length < 8) {
    throw new ValidationError("error.validation.passwordShort");
  }
  if (value.length > 256) {
    throw new ValidationError("error.validation.passwordLong");
  }
  return value;
}

export function validateEmail(value: string): string {
  const trimmed = value.trim();
  if (!/^[^\s@]+@[^\s@]+$/.test(trimmed)) {
    throw new ValidationError("error.validation.emailInvalid");
  }
  return trimmed;
}

export const FULL_NAME_MAX = 200;

export function validateFullName(value: string): string {
  const trimmed = value.trim();
  const length = [...trimmed].length;
  if (length === 0) {
    throw new ValidationError("error.validation.fullNameRequired");
  }
  if (length > FULL_NAME_MAX) {
    throw new ValidationError("error.validation.fullNameTooLong", { max: FULL_NAME_MAX });
  }
  return trimmed;
}

export function normalizeOptionalFullName(value: string | null | undefined): string | null | undefined {
  if (value === undefined || value === null) return value;
  const trimmed = value.trim();
  return trimmed.length === 0 ? null : validateFullName(trimmed);
}

export function validateTotpCode(value: string): string {
  const trimmed = value.trim();
  if (!/^\d{6}$/.test(trimmed) && !/^[A-Za-z0-9-]{6,}$/.test(trimmed)) {
    throw new ValidationError("error.validation.totpInvalid");
  }
  return trimmed;
}
