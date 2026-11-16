import { ValidationError } from "./errors";

export function requireId(value: string, label: string): string {
  const trimmed = value.trim();
  if (!trimmed) throw new ValidationError(`${label}: идентификатор обязателен`);
  return trimmed;
}

export function requireText(value: string, label: string): string {
  const trimmed = value.trim();
  if (!trimmed) throw new ValidationError(`${label} обязательно`);
  return trimmed;
}

export function requirePort(value: number, label: string): number {
  if (!Number.isInteger(value) || value < 1 || value > 65_535) {
    throw new ValidationError(`${label}: порт должен быть от 1 до 65535`);
  }
  return value;
}

export function requireMtu(value: number): number {
  if (!Number.isInteger(value) || value < 576 || value > 65_535) {
    throw new ValidationError("MTU должен быть от 576 до 65535");
  }
  return value;
}

export function requireRate(value: number, label: string): number {
  if (!Number.isFinite(value) || value < 0) {
    throw new ValidationError(`${label}: скорость не может быть отрицательной`);
  }
  return Math.trunc(value);
}

export function validatePassword(value: string): string {
  if (value.length < 8) {
    throw new ValidationError("Пароль должен содержать не менее 8 символов");
  }
  if (value.length > 256) {
    throw new ValidationError("Пароль слишком длинный");
  }
  return value;
}
