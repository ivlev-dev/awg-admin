import { TariffForm } from "@/features/tariffs/tariff.form";

interface TariffFormValues {
  name?: string;
  description?: string;
  maxDevices?: number;
  deviceDownKbps?: number;
  deviceUpKbps?: number;
  groupDownKbps?: number;
  groupUpKbps?: number;
  quotaGb?: number;
  interfaceId?: string;
}

function validForm(overrides: TariffFormValues = {}): TariffForm {
  const form = new TariffForm();
  form.setValues({
    name: "Basic",
    description: "",
    maxDevices: 5,
    deviceDownKbps: 100,
    deviceUpKbps: 50,
    groupDownKbps: 200,
    groupUpKbps: 100,
    quotaGb: 0,
    interfaceId: "if1",
    ...overrides,
  });
  return form;
}

describe("TariffForm", () => {
  it("принимает корректные данные", async () => {
    const form = validForm();

    await expect(form.validate()).resolves.toBe(true);
  });

  it("требует название тарифа", async () => {
    const form = validForm({ name: "" });

    await form.validate();

    expect(form.getFieldProps("name").error).toBe("Название тарифа обязательно");
  });

  it("ограничивает название 120 символами", async () => {
    const form = validForm({ name: "a".repeat(121) });

    await form.validate();

    expect(form.getFieldProps("name").error).toContain("120");
  });

  it("ограничивает описание 500 символами и допускает пустое", async () => {
    const form = validForm({ description: "" });
    await expect(form.validate()).resolves.toBe(true);

    form.description = "a".repeat(501);
    await form.validate();
    expect(form.getFieldProps("description").error).toContain("500");
  });

  it("допускает пустой интерфейс", async () => {
    const form = validForm({ interfaceId: "" });

    await expect(form.validate()).resolves.toBe(true);
    expect(form.getFieldProps("interfaceId").error).toBeUndefined();
  });

  it("проверяет диапазон максимального числа устройств", async () => {
    for (const value of [0, 1001, 2.5]) {
      const form = validForm({ maxDevices: value });
      await form.validate();
      expect(form.getFieldProps("maxDevices").error).toBeDefined();
    }

    const edge = validForm({ maxDevices: 1000 });
    await expect(edge.validate()).resolves.toBe(true);
  });

  it("отклоняет отрицательные лимиты скорости", async () => {
    const form = validForm({
      deviceDownKbps: -1,
      deviceUpKbps: -1,
      groupDownKbps: -1,
      groupUpKbps: -1,
    });

    await form.validate();

    expect(form.getFieldProps("deviceDownKbps").error).toContain("не меньше 0");
    expect(form.getFieldProps("deviceUpKbps").error).toContain("не меньше 0");
    expect(form.getFieldProps("groupDownKbps").error).toContain("не меньше 0");
    expect(form.getFieldProps("groupUpKbps").error).toContain("не меньше 0");
  });

  it("допускает нулевые лимиты как «без ограничения»", async () => {
    const form = validForm({
      deviceDownKbps: 0,
      deviceUpKbps: 0,
      groupDownKbps: 0,
      groupUpKbps: 0,
    });

    await expect(form.validate()).resolves.toBe(true);
  });

  it("проверяет квоту: неотрицательное число или пусто", async () => {
    const negative = validForm({ quotaGb: -1 });
    await negative.validate();
    expect(negative.getFieldProps("quotaGb").error).toContain("не меньше 0");

    const fraction = validForm({ quotaGb: 1.5 });
    await expect(fraction.validate()).resolves.toBe(true);

    const empty = validForm({ quotaGb: "" as unknown as number });
    await expect(empty.validate()).resolves.toBe(true);
  });

  it("показывает серверную ошибку поля", () => {
    const form = validForm();
    form.setFieldErrors("name", "Тариф уже существует");

    expect(form.getFieldProps("name").error).toBe("Тариф уже существует");
  });
});
