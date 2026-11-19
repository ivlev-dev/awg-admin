import { readFileSync, readdirSync } from "node:fs";
import { join, relative } from "node:path";

import { en } from "@/i18n/en";
import { ValidationError, userMessage } from "@/application/errors";
import { ApiError } from "@/domain/errors";
import { setLocale } from "@/i18n";

const CYRILLIC = /[А-Яа-яЁё]/;
const srcDir = join(process.cwd(), "src");

function sourceFiles(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const full = join(dir, entry.name);
    if (entry.isDirectory()) {
      if (entry.name === "locales") return [];
      return sourceFiles(full);
    }
    return /\.(ts|tsx)$/.test(entry.name) ? [full] : [];
  });
}

function stripComments(source: string): string {
  return source.replace(/\/\*[\s\S]*?\*\//g, "").replace(/(^|[^:])\/\/.*$/gm, "$1");
}

function stringLiterals(source: string): string[] {
  const values: string[] = [];
  const pattern = /"((?:\\.|[^"\\])*)"|'((?:\\.|[^'\\])*)'|`((?:\\.|[^`\\])*)`/g;
  for (const match of source.matchAll(pattern)) {
    values.push(match[1] ?? match[2] ?? match[3] ?? "");
  }
  return values;
}

afterEach(() => {
  setLocale("ru");
});

describe("нет захардкоженного русского текста", () => {
  it("не содержит кириллицы в строковых литералах вне локалей", () => {
    const offenders: string[] = [];
    for (const file of sourceFiles(srcDir)) {
      const literals = stringLiterals(stripComments(readFileSync(file, "utf8")));
      if (literals.some((value) => CYRILLIC.test(value))) {
        offenders.push(relative(srcDir, file));
      }
    }
    expect(offenders).toEqual([]);
  });

  it("не содержит кириллицы в текстах ошибок и валидации EN-словаря", () => {
    const errors = Object.entries(en).filter(
      ([key]) => key.startsWith("error.") || key.startsWith("validation."),
    );
    expect(errors.length).toBeGreaterThan(0);
    const offenders = errors.filter(([, value]) => CYRILLIC.test(value));
    expect(offenders).toEqual([]);
  });
});

describe("EN-режим: ошибки без кириллицы", () => {
  it("валидация и API-ошибки локализованы", () => {
    setLocale("en");
    const messages = [
      userMessage(new ValidationError("error.validation.passwordShort"), "Fallback"),
      userMessage(new ValidationError("error.validation.totpInvalid"), "Fallback"),
      userMessage(
        new ValidationError("error.validation.idRequired", { label: "error.label.user" }),
        "Fallback",
      ),
      userMessage(new ApiError(400, "bad_request", "Ошибка сервера"), "Fallback"),
    ];
    for (const message of messages) {
      expect(message.length).toBeGreaterThan(0);
      expect(CYRILLIC.test(message)).toBe(false);
    }
  });
});
