import { CreateDeviceForm } from "@/features/clients/ClientsPage.form";
import { DeviceEditForm } from "@/features/clients/details/edit.form";
import { ShareForm } from "@/features/clients/details/share.form";
import { TunnelForm } from "@/features/clients/details/tunnels.form";

describe("CreateDeviceForm", () => {
  it("требует непустое имя не длиннее 64 символов", async () => {
    const form = new CreateDeviceForm({ formId: "test-create" });

    await form.validateField("name");
    expect(form.getFieldProps("name").error).toBe("Имя устройства не может быть пустым");

    form.name = "x".repeat(65);
    await form.validateField("name");
    expect(form.getFieldProps("name").error).toBe("Имя устройства: не длиннее 64 символов");

    form.name = "laptop";
    await form.validateField("name");
    expect(form.getFieldProps("name").error).toBeUndefined();
  });

  it("требует владельца только в режиме администратора", async () => {
    const form = new CreateDeviceForm({ formId: "test-create" });

    await form.validateField("userId");
    expect(form.getFieldProps("userId").error).toBeUndefined();

    form.adminMode = true;
    await form.validateField("userId");
    expect(form.getFieldProps("userId").error).toBe("Выберите пользователя устройства");

    form.userId = "u2";
    await form.validateField("userId");
    expect(form.getFieldProps("userId").error).toBeUndefined();
  });

  it("требует интерфейс только когда он обязателен", async () => {
    const form = new CreateDeviceForm({ formId: "test-create" });

    await form.validateField("interfaceIds");
    expect(form.getFieldProps("interfaceIds").error).toBeUndefined();

    form.interfaceRequired = true;
    await form.validateField("interfaceIds");
    expect(form.getFieldProps("interfaceIds").error).toBe(
      "Выберите хотя бы один интерфейс для устройства",
    );

    form.interfaceIds = ["i1"];
    await form.validateField("interfaceIds");
    expect(form.getFieldProps("interfaceIds").error).toBeUndefined();
  });

  it("отклоняет отрицательные и дробные лимиты", async () => {
    const form = new CreateDeviceForm({ formId: "test-create" });

    form.downKbps = -1;
    form.upKbps = 1.5;

    await form.validateField("downKbps");
    await form.validateField("upKbps");
    expect(form.getFieldProps("downKbps").error).toBe("Лимит не может быть отрицательным");
    expect(form.getFieldProps("upKbps").error).toBe("Лимит должен быть целым числом");
  });
});

describe("DeviceEditForm", () => {
  it("валидирует имя и лимиты", async () => {
    const form = new DeviceEditForm({ formId: "test-edit" });

    form.name = "x".repeat(65);
    form.downKbps = -5;
    await form.validate();
    expect(form.getFieldProps("name").error).toBe("Имя устройства: не длиннее 64 символов");
    expect(form.getFieldProps("downKbps").error).toBe("Лимит не может быть отрицательным");
  });
});

describe("TunnelForm", () => {
  it("допускает пустую метку при добавлении и требует интерфейс", async () => {
    const form = new TunnelForm({ formId: "test-tunnel" });
    form.mode = "add";

    await form.validate();
    expect(form.getFieldProps("interfaceId").error).toBe("Выберите интерфейс туннеля");
    expect(form.getFieldProps("addLabel").error).toBeUndefined();

    form.interfaceId = "i1";
    expect(await form.validate()).toBe(true);
  });

  it("ограничивает метку добавления 64 символами", async () => {
    const form = new TunnelForm({ formId: "test-tunnel" });
    form.mode = "add";
    form.interfaceId = "i1";
    form.addLabel = "a".repeat(65);

    await form.validateField("addLabel");
    expect(form.getFieldProps("addLabel").error).toBe("Не длиннее 64 символов");
  });

  it("требует метку при переименовании и ограничивает её длину", async () => {
    const form = new TunnelForm({ formId: "test-tunnel" });
    form.mode = "rename";

    await form.validateField("renameLabel");
    expect(form.getFieldProps("renameLabel").error).toBe("Укажите метку туннеля");

    form.renameLabel = "a".repeat(65);
    await form.validateField("renameLabel");
    expect(form.getFieldProps("renameLabel").error).toBe("Не длиннее 64 символов");

    form.renameLabel = "renamed";
    expect(await form.validate()).toBe(true);
  });
});

describe("ShareForm", () => {
  it("допускает только значения ttl из списка", async () => {
    const form = new ShareForm({ formId: "test-share" });
    expect(await form.validate()).toBe(true);

    form.ttl = 123;
    await form.validateField("ttl");
    expect(form.getFieldProps("ttl").error).toBe(
      "Срок жизни ссылки должен быть положительным числом секунд",
    );
  });

  it("проверяет лимит использований и пустое значение", async () => {
    const form = new ShareForm({ formId: "test-share" });

    form.maxUsesEmpty = false;
    form.maxUses = 0;
    await form.validateField("maxUses");
    expect(form.getFieldProps("maxUses").error).toBe(
      "Лимит использований должен быть от 1 до 1000",
    );

    form.maxUses = "abc";
    await form.validateField("maxUses");
    expect(form.getFieldProps("maxUses").error).toBe(
      "Лимит использований должен быть целым числом",
    );

    form.maxUses = 1001;
    await form.validateField("maxUses");
    expect(form.getFieldProps("maxUses").error).toBe(
      "Лимит использований должен быть от 1 до 1000",
    );

    form.maxUses = 1000;
    await form.validateField("maxUses");
    expect(form.getFieldProps("maxUses").error).toBeUndefined();

    form.maxUsesEmpty = true;
    form.maxUses = 0;
    await form.validateField("maxUses");
    expect(form.getFieldProps("maxUses").error).toBeUndefined();
  });

  it("игнорирует лимит для одноразовой ссылки", async () => {
    const form = new ShareForm({ formId: "test-share" });
    form.oneTime = true;
    form.maxUsesEmpty = false;
    form.maxUses = 0;

    await form.validateField("maxUses");
    expect(form.getFieldProps("maxUses").error).toBeUndefined();
    expect(form.maxUses).toBe(0);
  });
});
