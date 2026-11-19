import { setLocale } from "@/i18n";
import {
  PEER_LABEL_MAX,
  requireId,
  requireMtu,
  requirePeerLabel,
  requirePort,
  requireRate,
  requireText,
  validateEmail,
  validatePassword,
  validateTotpCode,
} from "@/application/guards";
import { ValidationError, userMessage } from "@/application/errors";

const CYRILLIC = /[А-Яа-яЁё]/;

function catchValidation(run: () => unknown): ValidationError {
  try {
    run();
  } catch (error) {
    if (error instanceof ValidationError) return error;
    throw error;
  }
  throw new Error("expected ValidationError");
}

afterEach(() => {
  setLocale("ru");
});

describe("guards: happy path", () => {
  it("normalizes valid input", () => {
    expect(requireId("  id-1  ", "error.label.user")).toBe("id-1");
    expect(requireText(" value ", "error.label.deviceName")).toBe("value");
    expect(requirePeerLabel(" tunnel ")).toBe("tunnel");
    expect(requirePort(51820, "error.label.endpointPort")).toBe(51820);
    expect(requireMtu(1420)).toBe(1420);
    expect(requireRate(100, "error.label.downRate")).toBe(100);
    expect(validatePassword("secret123")).toBe("secret123");
    expect(validateEmail(" user@example.com ")).toBe("user@example.com");
    expect(validateTotpCode("123456")).toBe("123456");
  });
});

describe("guards: validation codes", () => {
  it("reports required identifiers and texts", () => {
    expect(catchValidation(() => requireId("  ", "error.label.user")).code).toBe(
      "error.validation.idRequired",
    );
    expect(catchValidation(() => requireText("", "error.label.deviceName")).code).toBe(
      "error.validation.textRequired",
    );
    expect(catchValidation(() => requirePeerLabel(" ")).code).toBe(
      "error.validation.peerLabelRequired",
    );
    expect(
      catchValidation(() => requirePeerLabel("x".repeat(PEER_LABEL_MAX + 1))).code,
    ).toBe("error.validation.peerLabelTooLong");
  });

  it("reports invalid ports, mtu and rates", () => {
    expect(catchValidation(() => requirePort(0, "error.label.listenPort")).code).toBe(
      "error.validation.portRange",
    );
    expect(catchValidation(() => requireMtu(100)).code).toBe("error.validation.mtuRange");
    expect(catchValidation(() => requireRate(-1, "error.label.upRate")).code).toBe(
      "error.validation.rateNegative",
    );
    expect(catchValidation(() => requireRate(Number.NaN, "error.label.upRate")).code).toBe(
      "error.validation.rateNegative",
    );
  });

  it("reports password, email and totp problems", () => {
    expect(catchValidation(() => validatePassword("short")).code).toBe(
      "error.validation.passwordShort",
    );
    expect(catchValidation(() => validatePassword("x".repeat(257))).code).toBe(
      "error.validation.passwordLong",
    );
    expect(catchValidation(() => validateEmail("nope")).code).toBe(
      "error.validation.emailInvalid",
    );
    expect(catchValidation(() => validateTotpCode("abc")).code).toBe(
      "error.validation.totpInvalid",
    );
  });
});

describe("guards: localization", () => {
  it("renders Russian messages with translated labels", () => {
    const message = userMessage(catchValidation(() => requireId("", "error.label.user")), "fallback");
    expect(message).toBe("Пользователь: идентификатор обязателен");
  });

  it("renders English messages without Cyrillic", () => {
    setLocale("en");
    const samples = [
      catchValidation(() => requireId("", "error.label.user")),
      catchValidation(() => requireText("", "error.label.deviceName")),
      catchValidation(() => requirePort(0, "error.label.endpointPort")),
      catchValidation(() => requireMtu(1)),
      catchValidation(() => requireRate(-1, "error.label.upRate")),
      catchValidation(() => validatePassword("x")),
      catchValidation(() => validatePassword("x".repeat(300))),
      catchValidation(() => validateEmail("nope")),
      catchValidation(() => validateTotpCode("nope")),
      catchValidation(() => requirePeerLabel("")),
      catchValidation(() => requirePeerLabel("x".repeat(PEER_LABEL_MAX + 1))),
    ];

    for (const error of samples) {
      const message = userMessage(error, "fallback");
      expect(message.length).toBeGreaterThan(0);
      expect(CYRILLIC.test(message)).toBe(false);
    }
  });
});
