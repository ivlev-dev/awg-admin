import {
  formatBytes,
  formatRate,
  formatPerSecond,
  formatPercent,
  formatDateRu,
  relativeTime,
  plural,
  percent,
} from "./format";

describe("formatBytes", () => {
  it("zero", () => {
    expect(formatBytes(0)).toBe("0 B");
  });

  it("bytes", () => {
    expect(formatBytes(512)).toBe("512 B");
  });

  it("KB", () => {
    expect(formatBytes(1024)).toBe("1.0 КБ");
  });

  it("MB", () => {
    expect(formatBytes(1024 * 1024)).toBe("1.0 МБ");
  });

  it("GB", () => {
    expect(formatBytes(1024 * 1024 * 1024)).toBe("1.0 ГБ");
  });

  it("negative becomes zero", () => {
    expect(formatBytes(-10)).toBe("0 B");
  });

  it("non-finite becomes zero", () => {
    expect(formatBytes(NaN)).toBe("0 B");
    expect(formatBytes(Infinity)).toBe("0 B");
  });
});

describe("formatRate", () => {
  it("zero means unlimited", () => {
    expect(formatRate(0)).toBe("Без лимита");
  });

  it("kbps", () => {
    expect(formatRate(500)).toBe("500 Кбит/с");
  });

  it("mbps", () => {
    expect(formatRate(1000)).toBe("1 Мбит/с");
    expect(formatRate(1500)).toBe("1.5 Мбит/с");
  });

  it("gbps", () => {
    expect(formatRate(1_000_000)).toBe("1.0 Гбит/с");
  });
});

describe("formatPerSecond", () => {
  it("zero", () => {
    expect(formatPerSecond(0)).toBe("0 Б/с");
  });

  it("converts kbps to bytes", () => {
    expect(formatPerSecond(8)).toBe("1000 B/с");
  });
});

describe("formatPercent", () => {
  it("keeps one decimal", () => {
    expect(formatPercent(0)).toBe("0.0 %");
    expect(formatPercent(42.345)).toBe("42.3 %");
    expect(formatPercent(100)).toBe("100.0 %");
  });

  it("handles missing values", () => {
    expect(formatPercent(null)).toBe("—");
    expect(formatPercent(undefined)).toBe("—");
    expect(formatPercent(Number.NaN)).toBe("—");
  });
});

describe("formatDateRu", () => {
  it("formats a date in ru locale", () => {
    const value = "2026-12-01T12:00:00Z";
    expect(formatDateRu(value)).toBe(new Date(value).toLocaleDateString("ru-RU"));
  });

  it("handles missing and invalid dates", () => {
    expect(formatDateRu(null)).toBe("—");
    expect(formatDateRu("")).toBe("—");
    expect(formatDateRu("not-a-date")).toBe("—");
  });
});

describe("relativeTime", () => {
  it("null", () => {
    expect(relativeTime(null)).toBe("никогда");
  });

  it("undefined", () => {
    expect(relativeTime(undefined)).toBe("никогда");
  });

  it("invalid date", () => {
    expect(relativeTime("not-a-date")).toBe("никогда");
  });
});

describe("plural", () => {
  it("one", () => {
    expect(plural(1, "устройство", "устройства", "устройств")).toBe("устройство");
  });

  it("few", () => {
    expect(plural(2, "устройство", "устройства", "устройств")).toBe("устройства");
    expect(plural(3, "устройство", "устройства", "устройств")).toBe("устройства");
  });

  it("many", () => {
    expect(plural(5, "устройство", "устройства", "устройств")).toBe("устройств");
    expect(plural(11, "устройство", "устройства", "устройств")).toBe("устройств");
  });
});

describe("percent", () => {
  it("basic", () => {
    expect(percent(50, 100)).toBe(50);
  });

  it("clamps to 100", () => {
    expect(percent(200, 100)).toBe(100);
  });

  it("clamps to 0", () => {
    expect(percent(-10, 100)).toBe(0);
  });

  it("zero total", () => {
    expect(percent(10, 0)).toBe(0);
  });
});