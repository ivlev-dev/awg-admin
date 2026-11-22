import type { Settings } from "@/domain/types";
import { SettingsForm } from "@/features/settings/settings.form";

const SETTINGS: Settings = {
  obfuscation: {
    profile: "tls",
    intensity: "high",
    browser: "firefox",
    mtu: 1420,
    jc_min: 4,
    jc_max: 12,
    jmin_min: 60,
    jmin_max: 240,
    jmax_extra_min: 5,
    jmax_extra_max: 120,
    s_min: 16,
    s_max: 72,
    hosts: ["example.com", "google.com"],
    random_trailers: true,
    disable_cookies: true,
    keepalive_min: 15,
    keepalive_max: 25,
  },
  share_default_ttl_secs: 7200,
};

const FORMS: SettingsForm[] = [];

function makeForm(settings?: Settings): SettingsForm {
  const form = settings === undefined ? new SettingsForm() : SettingsForm.from(settings);
  FORMS.push(form);
  return form;
}

function inputEvent(value: string): Event {
  const event = new Event("input");
  Object.defineProperty(event, "target", { value: { value, type: "number" } });
  return event;
}

afterEach(() => {
  for (const form of FORMS.splice(0)) form.dispose();
});

describe("SettingsForm", () => {
  it("инициализируется значениями сервера без изменений", () => {
    const form = makeForm(SETTINGS);

    expect(form.profile).toBe("tls");
    expect(form.intensity).toBe("high");
    expect(form.browser).toBe("firefox");
    expect(form.mtu).toBe(1420);
    expect(form.jcMin).toBe(4);
    expect(form.sMin).toBe(16);
    expect(form.hosts).toBe("example.com\ngoogle.com");
    expect(form.ttlHours).toBe(2);
    expect(form.isDirty).toBe(false);
  });

  it("считает форму изменённой после правки поля", () => {
    const form = makeForm(SETTINGS);
    form.getFieldProps("mtu").setValue(1500);

    expect(form.isDirty).toBe(true);
  });

  it("ограничивает числовые диапазоны", async () => {
    const form = makeForm();
    form.getFieldProps("mtu").onInput(inputEvent("100"));
    form.getFieldProps("sMin").onInput(inputEvent("3"));
    form.getFieldProps("keepaliveMax").onInput(inputEvent("200"));

    await expect(form.validate()).resolves.toBe(false);
    expect(form.getFieldProps("mtu").error).toBeDefined();
    expect(form.getFieldProps("sMin").error).toBeDefined();
    expect(form.getFieldProps("keepaliveMax").error).toBeDefined();
  });

  it("отклоняет пустое числовое значение", async () => {
    const form = makeForm();
    form.getFieldProps("mtu").onInput(inputEvent(""));

    await expect(form.validate()).resolves.toBe(false);
    expect(form.getFieldProps("mtu").error).toBeDefined();
  });

  it("принимает значения на границах диапазонов", async () => {
    const form = makeForm();
    form.getFieldProps("mtu").setValue(576);
    form.getFieldProps("sMin").setValue(12);
    form.getFieldProps("keepaliveMax").setValue(120);
    form.getFieldProps("ttlHours").setValue(0);

    await expect(form.validate()).resolves.toBe(true);
  });

  it("валидирует список хостов", async () => {
    const form = makeForm();

    form.getFieldProps("hosts").setValue("");
    await expect(form.validate()).resolves.toBe(true);

    form.getFieldProps("hosts").setValue("example.com\ngoogle.com");
    await expect(form.validate()).resolves.toBe(true);

    form.getFieldProps("hosts").setValue("bad host.example.com");
    await expect(form.validate()).resolves.toBe(false);
    expect(form.getFieldProps("hosts").error).toBeDefined();
  });

  it("отклоняет неизвестный профиль, интенсивность и браузер", async () => {
    const form = makeForm();
    form.getFieldProps("profile").setValue("unknown" as never);
    form.getFieldProps("intensity").setValue("unknown" as never);
    form.getFieldProps("browser").setValue("unknown" as never);

    await expect(form.validate()).resolves.toBe(false);
    expect(form.getFieldProps("profile").error).toBeDefined();
    expect(form.getFieldProps("intensity").error).toBeDefined();
    expect(form.getFieldProps("browser").error).toBeDefined();
  });
});
