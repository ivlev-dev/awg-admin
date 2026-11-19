import {
  formatPercent,
  initials,
  percent,
  userAgentLabel,
  csvCell,
} from "@/domain/format";

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

describe("initials", () => {
  it("takes the first letter in upper case", () => {
    expect(initials(" alice ")).toBe("A");
  });

  it("falls back to a question mark", () => {
    expect(initials("   ")).toBe("?");
  });
});

describe("userAgentLabel", () => {
  it("combines browser and operating system", () => {
    expect(
      userAgentLabel(
        "Mozilla/5.0 (Windows NT 10.0) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0 Safari/537.36",
      ),
    ).toBe("Chrome · Windows");
  });

  it("returns null for empty and unknown agents", () => {
    expect(userAgentLabel(null)).toBeNull();
    expect(userAgentLabel("   ")).toBeNull();
    expect(userAgentLabel("curl/8.0")).toBeNull();
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

describe("csvCell", () => {
  it("prefixes formula-like values with an apostrophe", () => {
    expect(csvCell("=1+1")).toBe("'=1+1");
    expect(csvCell("@SUM(A1)")).toBe("'@SUM(A1)");
    expect(csvCell("-2")).toBe("'-2");
    expect(csvCell("+7")).toBe("'+7");
    expect(csvCell("\tcmd")).toBe("'\tcmd");
    expect(csvCell("\rcmd")).toBe("\"'\rcmd\"");
  });

  it("keeps ordinary text unchanged", () => {
    expect(csvCell("laptop")).toBe("laptop");
  });

  it("quotes commas, quotes and newlines after escaping", () => {
    expect(csvCell("a,b")).toBe('"a,b"');
    expect(csvCell('say "hi"')).toBe('"say ""hi"""');
    expect(csvCell("=1,2")).toBe("\"'=1,2\"");
  });
});
