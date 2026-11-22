import { passwordPolicyIssue, type PasswordPolicyIssue } from "@/domain/validation";
import { t, type TranslationKey } from "@/i18n";

const PASSWORD_ISSUE_CODES: Record<PasswordPolicyIssue, TranslationKey> = {
  short: "error.validation.passwordShort",
  long: "error.validation.passwordLong",
  common: "error.validation.passwordCommon",
  email: "error.validation.passwordEmailLocal",
};

export function passwordIssueMessage(password: string, email: string): string | null {
  const issue = passwordPolicyIssue(password, email);
  return issue === null ? null : t(PASSWORD_ISSUE_CODES[issue]);
}
