import { InterfaceEditForm, InterfaceForm } from "@/features/interfaces/interface.form";

function filled(): InterfaceForm {
  const form = new InterfaceForm();
  form.groupId = "g1";
  form.nodeId = "n1";
  form.name = "wg0";
  form.endpointHost = "vpn.example.com";
  return form;
}

describe("InterfaceForm", () => {
  it("требует группу, ноду, имя и endpoint host", async () => {
    const form = new InterfaceForm();

    expect(await form.validate()).toBe(false);
    expect(form.getFieldProps("groupId").error).toBe("Выберите группу");
    expect(form.getFieldProps("nodeId").error).toBe("Выберите ноду");
    expect(form.getFieldProps("name").error).toBe("Имя: латиница, цифры, _ и -");
    expect(form.getFieldProps("endpointHost").error).toBe("Укажите host без пробелов");
  });

  it("принимает корректные значения", async () => {
    const form = filled();

    expect(await form.validate()).toBe(true);
    expect(form.isReady).toBe(true);
  });

  it.each(["awg 0", "awg.", "имя", "awg/0"])("отклоняет имя %s", async (name) => {
    const form = filled();
    form.getFieldProps("name").setValue(name);

    expect(await form.validate()).toBe(false);
    expect(form.getFieldProps("name").error).toBe("Имя: латиница, цифры, _ и -");
  });

  it("отклоняет имя длиннее 15 символов", async () => {
    const form = filled();
    form.getFieldProps("name").setValue("abcdefghijklmnop");

    expect(await form.validate()).toBe(false);
    expect(form.getFieldProps("name").error).toBe("Имя — не более 15 символов");
  });

  it("принимает имя из 15 символов и обрезает пробелы по краям", async () => {
    const form = filled();
    form.getFieldProps("name").setValue(" abcdefghijklmno ");

    expect(await form.validate()).toBe(true);
    expect(form.name).toBe(" abcdefghijklmno ");
  });

  it("ограничивает метку 64 символами", async () => {
    const form = filled();
    form.getFieldProps("label").setValue("l".repeat(65));

    expect(await form.validate()).toBe(false);
    expect(form.getFieldProps("label").error).toBe("Метка — не более 64 символов");

    form.getFieldProps("label").setValue("l".repeat(64));
    expect(await form.validate()).toBe(true);
  });

  it.each(["0", "65536", "-1", "1.5"])(
    "отклоняет endpoint port %s",
    async (value) => {
      const form = filled();
      form.getFieldProps("endpointPort").onInput({ currentTarget: { value } });
      await new Promise((resolve) => setTimeout(resolve, 0));

      expect(form.getFieldProps("endpointPort").error).toBe(
        "Порт — целое число от 1 до 65535",
      );
    },
  );

  it.each(["", "abc"])("ловит нечисловой endpoint port %s", async (value) => {
    const form = filled();
    form.getFieldProps("endpointPort").onInput({ currentTarget: { value } });
    await new Promise((resolve) => setTimeout(resolve, 0));

    expect(form.getFieldProps("endpointPort").error).toBeDefined();
    expect(form.isReady).toBe(false);
  });

  it.each(["", "abc"])("ловит нечисловой listen port %s", async (value) => {
    const form = filled();
    form.getFieldProps("listenPort").onInput({ currentTarget: { value } });
    await new Promise((resolve) => setTimeout(resolve, 0));

    expect(form.getFieldProps("listenPort").error).toBeDefined();
    expect(form.isReady).toBe(false);
  });

  it("приводит непустую строку порта к числу", () => {
    const form = new InterfaceForm();
    form.getFieldProps("endpointPort").onInput({ currentTarget: { value: "8443" } });

    expect(form.endpointPort).toBe(8443);
  });

  it("оставляет пустой порт строкой", () => {
    const form = new InterfaceForm();
    form.getFieldProps("endpointPort").onInput({ currentTarget: { value: "" } });

    expect(form.endpointPort).toBe("");
  });

  it.each(["575", "65536"])("отклоняет MTU %s", async (value) => {
    const form = filled();
    form.getFieldProps("mtu").onInput({ currentTarget: { value } });
    await new Promise((resolve) => setTimeout(resolve, 0));

    expect(form.getFieldProps("mtu").error).toBe("MTU — от 576 до 65535");
  });

  it.each(["", "abc"])("ловит нечисловой MTU %s", async (value) => {
    const form = filled();
    form.getFieldProps("mtu").onInput({ currentTarget: { value } });
    await new Promise((resolve) => setTimeout(resolve, 0));

    expect(form.getFieldProps("mtu").error).toBeDefined();
    expect(form.isReady).toBe(false);
  });

  it("принимает граничные значения MTU", async () => {
    const form = filled();

    form.mtu = 576;
    expect(await form.validate()).toBe(true);

    form.mtu = 65535;
    expect(await form.validate()).toBe(true);
  });

  it("отклоняет endpoint host с пробелами", async () => {
    const form = filled();
    form.getFieldProps("endpointHost").setValue("vpn example.com");

    expect(await form.validate()).toBe(false);
    expect(form.getFieldProps("endpointHost").error).toBe("Укажите host без пробелов");
  });
});

describe("InterfaceEditForm", () => {
  function editForm(): InterfaceEditForm {
    const form = new InterfaceEditForm();
    form.label = "Основной";
    form.endpointHost = "vpn.example.com";
    form.endpointPort = 443;
    form.listenPort = 51820;
    form.mtu = 1420;
    form.enabled = true;
    return form;
  }

  it("не редактирует имя, группу и ноду", () => {
    const form = new InterfaceEditForm();

    expect("name" in form).toBe(false);
    expect("groupId" in form).toBe(false);
    expect("nodeId" in form).toBe(false);
  });

  it("принимает корректные значения и переключает состояние", async () => {
    const form = editForm();
    form.getFieldProps("enabled").onChange({ currentTarget: { checked: false, type: "checkbox" } });

    expect(form.enabled).toBe(false);
    expect(await form.validate()).toBe(true);
    expect(form.isReady).toBe(true);
  });

  it("проверяет host, порты и MTU", async () => {
    const form = editForm();
    form.getFieldProps("endpointHost").setValue(" ");
    form.getFieldProps("endpointPort").setValue(0);
    form.getFieldProps("listenPort").setValue(65536);
    form.getFieldProps("mtu").setValue(575);

    expect(await form.validate()).toBe(false);
    expect(form.getFieldProps("endpointHost").error).toBe("Укажите host без пробелов");
    expect(form.getFieldProps("endpointPort").error).toBe("Порт — целое число от 1 до 65535");
    expect(form.getFieldProps("listenPort").error).toBe("Порт — целое число от 1 до 65535");
    expect(form.getFieldProps("mtu").error).toBe("MTU — от 576 до 65535");
  });

  it("ограничивает метку 64 символами", async () => {
    const form = editForm();
    form.getFieldProps("label").setValue("l".repeat(65));

    expect(await form.validate()).toBe(false);
    expect(form.getFieldProps("label").error).toBe("Метка — не более 64 символов");
  });
});
