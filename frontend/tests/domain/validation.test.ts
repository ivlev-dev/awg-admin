import type { Tariff } from "@/domain/types";
import { validateTariff, isCidr, cidrContains } from "@/domain/validation";

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
  interface_id: null,
  interface_name: null,
    created_at: "2020-01-01T00:00:00Z",
    updated_at: "2020-01-01T00:00:00Z",
    ...overrides,
  };
}

describe("validateTariff", () => {
  it("empty name", () => {
    const tariff = makeTariff({ name: "   " });
    const { id, created_at, updated_at, ...input } = tariff;
    expect(validateTariff(input)).toEqual({ code: "error.validation.tariffName" });
  });

  it("max_devices 0", () => {
    const tariff = makeTariff({ max_devices: 0 });
    const { id, created_at, updated_at, ...input } = tariff;
    expect(validateTariff(input)).toEqual({ code: "error.validation.tariffMaxDevices" });
  });

  it("device > group", () => {
    const tariff = makeTariff({
      device_down_kbps: 300,
      group_down_kbps: 200,
    });
    const { id, created_at, updated_at, ...input } = tariff;
    expect(validateTariff(input)).toEqual({ code: "error.validation.tariffDeviceDown" });
  });

  it("device upload > group upload", () => {
    const tariff = makeTariff({
      device_up_kbps: 300,
      group_up_kbps: 200,
    });
    const { id, created_at, updated_at, ...input } = tariff;
    expect(validateTariff(input)).toEqual({ code: "error.validation.tariffDeviceUp" });
  });

  it("valid", () => {
    const tariff = makeTariff();
    const { id, created_at, updated_at, ...input } = tariff;
    expect(validateTariff(input)).toBeNull();
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
