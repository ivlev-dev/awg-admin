import type { Tariff } from "@/domain/types";
import {
  clampDeviceLimits,
  validateGroupSum,
  validateTariff,
  isCidr,
  cidrContains,
} from "@/domain/validation";

function makeTariff(overrides: Partial<Tariff> = {}): Tariff {
  return {
    id: "tariff-1",
    name: "Basic",
    description: "",
    max_devices: 2,
    device_down_kbps: 100,
    device_up_kbps: 50,
    group_down_kbps: 200,
    group_up_kbps: 100,
    traffic_quota_bytes: null,
    created_at: "2020-01-01T00:00:00Z",
    updated_at: "2020-01-01T00:00:00Z",
    ...overrides,
  };
}

describe("clampDeviceLimits", () => {
  it("max 0 means unlimited", () => {
    const tariff = makeTariff({ device_down_kbps: 0, device_up_kbps: 0 });
    expect(clampDeviceLimits(tariff, { down: 7, up: 9 })).toEqual({
      down: 7,
      up: 9,
    });
  });

  it("requested 0 becomes max", () => {
    const tariff = makeTariff({ device_down_kbps: 100, device_up_kbps: 50 });
    expect(clampDeviceLimits(tariff, { down: 0, up: 0 })).toEqual({
      down: 100,
      up: 50,
    });
  });

  it("clamps requested to max", () => {
    const tariff = makeTariff({ device_down_kbps: 100, device_up_kbps: 50 });
    expect(clampDeviceLimits(tariff, { down: 200, up: 10 })).toEqual({
      down: 100,
      up: 10,
    });
  });
});

describe("validateGroupSum", () => {
  it("exceeds down", () => {
    const tariff = makeTariff({ group_down_kbps: 100 });
    expect(
      validateGroupSum(tariff, [
        { down: 60, up: 10 },
        { down: 60, up: 10 },
      ]),
    ).not.toBeNull();
  });

  it("exceeds up", () => {
    const tariff = makeTariff({ group_up_kbps: 50 });
    expect(
      validateGroupSum(tariff, [
        { down: 10, up: 30 },
        { down: 10, up: 30 },
      ]),
    ).not.toBeNull();
  });

  it("ok", () => {
    const tariff = makeTariff();
    expect(
      validateGroupSum(tariff, [
        { down: 100, up: 50 },
        { down: 50, up: 25 },
      ]),
    ).toBeNull();
  });
});

describe("validateTariff", () => {
  it("empty name", () => {
    const tariff = makeTariff({ name: "   " });
    const { id, created_at, updated_at, ...input } = tariff;
    expect(validateTariff(input)).toBe("Название тарифа обязательно");
  });

  it("max_devices 0", () => {
    const tariff = makeTariff({ max_devices: 0 });
    const { id, created_at, updated_at, ...input } = tariff;
    expect(validateTariff(input)).toBe(
      "Тариф должен разрешать хотя бы одно устройство",
    );
  });

  it("device > group", () => {
    const tariff = makeTariff({
      device_down_kbps: 300,
      group_down_kbps: 200,
    });
    const { id, created_at, updated_at, ...input } = tariff;
    expect(validateTariff(input)).toBe(
      "Лимит устройства не может превышать лимит группы",
    );
  });
});

describe("isCidr", () => {
  it("valid", () => {
    expect(isCidr("10.0.0.0/24")).toBe(true);
  });

  it("invalid octet", () => {
    expect(isCidr("256.0.0.0/24")).toBe(false);
  });

  it("invalid prefix", () => {
    expect(isCidr("10.0.0.0/33")).toBe(false);
  });

  it("not cidr", () => {
    expect(isCidr("hello")).toBe(false);
  });
});

describe("cidrContains", () => {
  it("contains", () => {
    expect(cidrContains("10.0.0.0/14", "10.1.0.0/24")).toBe(true);
  });

  it("does not contain", () => {
    expect(cidrContains("10.0.0.0/14", "11.0.0.0/24")).toBe(false);
  });
});