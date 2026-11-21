import { ApiError } from "@/domain/errors";
import { t, type Params, type TranslationKey } from "@/i18n";

export class ValidationError extends Error {
  readonly code: string;
  readonly params: Params | undefined;

  constructor(code: string, params?: Params) {
    super(code);
    this.name = "ValidationError";
    this.code = code;
    this.params = params;
  }
}

export interface ValidationIssue {
  readonly code: string;
  readonly params?: Params;
}

export function issueMessage(issue: ValidationIssue | null): string | null {
  return issue === null ? null : translate(issue.code, issue.params);
}

export function userMessage(error: unknown, fallback: string): string {
  if (error instanceof ValidationError) return translate(error.code, error.params);
  if (error instanceof ApiError) {
    if (error.code === "aborted") return "";
    if (error.status !== 0) return fallback;
  }
  if (error instanceof Error) {
    const message = error.message.trim();
    if (message) return message;
  }
  return fallback;
}

function translate(code: string, params: Params | undefined): string {
  const key = code as TranslationKey;
  if (params === undefined) return t(key);
  const label = params["label"];
  const resolved =
    typeof label === "string" && label.length > 0
      ? { ...params, label: t(label as TranslationKey) }
      : params;
  return t(key, resolved);
}
