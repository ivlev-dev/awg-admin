import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";

import { ValidationError, issueMessage, userMessage } from "@/application/errors";
import { ApiError } from "@/domain/errors";
import { setLocale, t } from "@/i18n";
import { validateTariff } from "@/domain/validation";

const CYRILLIC = /[А-Яа-яЁё]/;

afterEach(() => {
  setLocale("ru");
});

describe("userMessage", () => {
  it("returns a localized fallback for API errors with a status", () => {
    const error = new ApiError(500, "server_error", "internal details");
    expect(userMessage(error, "Fallback text")).toBe("Fallback text");
  });

  it("keeps the transport message for network errors", () => {
    expect(userMessage(new ApiError(0, "network_error", "Failed to fetch"), "Fallback")).toBe(
      "Failed to fetch",
    );
  });

  it("keeps plain error messages and falls back for unknown values", () => {
    expect(userMessage(new Error("boom"), "Fallback")).toBe("boom");
    expect(userMessage(new Error("   "), "Fallback")).toBe("Fallback");
    expect(userMessage("boom", "Fallback")).toBe("Fallback");
    expect(userMessage(null, "Fallback")).toBe("Fallback");
  });

  it("resolves ValidationError codes and translates labels", () => {
    const error = new ValidationError("error.validation.textRequired", {
      label: "error.label.deviceName",
    });
    expect(userMessage(error, "Fallback")).toBe("Имя устройства обязательно");

    setLocale("en");
    expect(userMessage(error, "Fallback")).toBe("Device name is required");
  });

  it("resolves domain validation issues", () => {
    const issue = validateTariff({
      name: "",
      max_devices: 1,
      device_down_kbps: 0,
      device_up_kbps: 0,
      group_down_kbps: 0,
      group_up_kbps: 0,
    });
    expect(issueMessage(issue)).toBe("Название тарифа обязательно");
    expect(issueMessage(null)).toBeNull();
  });

  it("produces the same text for every caller", () => {
    const error = new ValidationError("error.validation.emailInvalid");
    const pages = ["users", "auth", "profile", "settings"];
    const messages = pages.map((page) => userMessage(error, t("app.error.unknown") + page));
    expect(new Set(messages).size).toBe(1);
    expect(messages[0]).toBe("Введите корректный email");
  });

  it("does not leak Cyrillic in English mode for API and validation errors", () => {
    setLocale("en");
    const validation = userMessage(new ValidationError("error.validation.emailInvalid"), "Fallback");
    const api = userMessage(new ApiError(409, "conflict", "Русский текст сервера"), "Fallback");
    expect(CYRILLIC.test(validation)).toBe(false);
    expect(CYRILLIC.test(api)).toBe(false);
  });
});

describe("unified error helper", () => {
  const featuresDir = join(process.cwd(), "src", "features");

  function files(dir: string): string[] {
    return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
      const full = join(dir, entry.name);
      if (entry.isDirectory()) return files(full);
      return /\.(ts|tsx)$/.test(entry.name) ? [full] : [];
    });
  }

  it("has no local messageOf copies in features", () => {
    const offenders = files(featuresDir).filter((file) => {
      const source = readFileSync(file, "utf8");
      return /function messageOf\b/.test(source) || /\bmessageOf\(/.test(source);
    });
    expect(offenders).toEqual([]);
  });
});
