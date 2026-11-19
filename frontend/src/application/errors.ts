export class ValidationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ValidationError";
  }
}

import { ApiError } from "@/domain/errors";

export function userMessage(error: unknown, fallback: string): string {
  if (error instanceof ApiError && error.status !== 0) return fallback;
  if (error instanceof Error) {
    const message = error.message.trim();
    if (message) return message;
  }
  return fallback;
}
