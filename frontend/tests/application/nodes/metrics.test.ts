import {
  formatCpuLoad,
  formatMetricsUpdated,
  formatNodeMemory,
  formatNodeMemoryPercent,
  formatTokenIssuedAt,
} from "@/application/nodes/metrics";
import { setLocale } from "@/i18n";

describe("node metrics helpers", () => {
  afterEach(() => {
    setLocale("ru");
  });

  it("formats cpu load", () => {
    expect(formatCpuLoad(0.5)).toBe("0.50");
    expect(formatCpuLoad(0)).toBe("0.00");
    expect(formatCpuLoad(null)).toBe("—");
    expect(formatCpuLoad(undefined)).toBe("—");
    expect(formatCpuLoad(Number.NaN)).toBe("—");
  });

  it("formats memory used and total", () => {
    expect(formatNodeMemory(1024, 2048)).toBe("1.0 КБ / 2.0 КБ");
    expect(formatNodeMemory(0, 0)).toBe("—");
    expect(formatNodeMemory(-1, 2048)).toBe("—");
    expect(formatNodeMemory(null, 2048)).toBe("—");
  });

  it("formats memory percent within bounds", () => {
    expect(formatNodeMemoryPercent(512, 1024)).toBe("50 %");
    expect(formatNodeMemoryPercent(1024, 1024)).toBe("100 %");
    expect(formatNodeMemoryPercent(2048, 1024)).toBe("100 %");
    expect(formatNodeMemoryPercent(null, 1024)).toBeNull();
    expect(formatNodeMemoryPercent(1, 0)).toBeNull();
  });

  it("formats relative metrics update time in both locales", () => {
    const fiveMinutesAgo = new Date(Date.now() - 5 * 60 * 1000).toISOString();
    expect(formatMetricsUpdated(fiveMinutesAgo)).toBe("5 минут назад");

    const fixedNow = Date.parse("2026-01-01T00:10:00Z");
    expect(formatMetricsUpdated("2026-01-01T00:00:00Z", fixedNow)).toBe("10 минут назад");

    setLocale("en");
    const tenMinutesAgo = new Date(Date.now() - 10 * 60 * 1000).toISOString();
    expect(formatMetricsUpdated(tenMinutesAgo)).toBe("10 minutes ago");
    expect(formatMetricsUpdated("2026-01-01T00:00:00Z", fixedNow)).toBe("10 minutes ago");
  });

  it("handles missing and invalid metrics timestamps", () => {
    expect(formatMetricsUpdated(null)).toBe("нет данных");
    expect(formatMetricsUpdated("not-a-date")).toBe("нет данных");

    setLocale("en");
    expect(formatMetricsUpdated(null)).toBe("no data");
  });

  it("formats the token issue date", () => {
    expect(formatTokenIssuedAt(null)).toBe("неизвестно");
    expect(formatTokenIssuedAt("2026-01-01T00:00:00Z")).not.toBe("—");

    setLocale("en");
    expect(formatTokenIssuedAt(undefined)).toBe("unknown");
  });
});
