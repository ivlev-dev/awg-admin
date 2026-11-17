import { formatRateBps } from "@/application/stats/rate";
import { setLocale } from "@/i18n";

afterEach(() => {
  setLocale("ru");
});

describe("formatRateBps", () => {
  it("форматирует байты в секунду", () => {
    expect(formatRateBps(512)).toBe("512 B/с");
    expect(formatRateBps(2048)).toBe("2.0 КБ/с");
  });

  it("возвращает ноль для пустых значений", () => {
    expect(formatRateBps(0)).toBe("0 B/с");
    expect(formatRateBps(null)).toBe("0 B/с");
    expect(formatRateBps(undefined)).toBe("0 B/с");
    expect(formatRateBps(Number.NaN)).toBe("0 B/с");
    expect(formatRateBps(Number.POSITIVE_INFINITY)).toBe("0 B/с");
  });

  it("не показывает отрицательную скорость", () => {
    expect(formatRateBps(-1024)).toBe("0 B/с");
  });

  it("переводит единицы при смене языка", () => {
    setLocale("en");

    expect(formatRateBps(2048)).toBe("2.0 KB/s");
  });
});
