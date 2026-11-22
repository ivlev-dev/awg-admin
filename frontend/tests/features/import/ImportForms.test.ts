import {
  GROUP_DESCRIPTION_MAX_LENGTH,
  GROUP_NAME_MAX_LENGTH,
  GroupImportForm,
} from "@/features/import/group.form";
import {
  ClientsImportForm,
  parsesClients,
} from "@/features/import/clients.form";

function validGroup(): GroupImportForm {
  const form = new GroupImportForm();
  form.groupName = "Imported";
  form.baseCidr = "10.8.0.0/24";
  form.nodeId = "n1";
  return form;
}

function validClients(): ClientsImportForm {
  const form = new ClientsImportForm();
  form.clientOwnerUserId = "u1";
  form.clientInterfaceId = "i1";
  form.clientsImportText = "[Interface]\nAddress = 10.8.0.2/24\nPrivateKey = key";
  return form;
}

const FORMS: Array<GroupImportForm | ClientsImportForm> = [];

function group(): GroupImportForm {
  const form = new GroupImportForm();
  FORMS.push(form);
  return form;
}

function clients(): ClientsImportForm {
  const form = new ClientsImportForm();
  FORMS.push(form);
  return form;
}

afterEach(() => {
  for (const form of FORMS.splice(0)) form.dispose();
});

describe("GroupImportForm", () => {
  it("требует имя группы и ноду", async () => {
    const form = group();

    expect(await form.validate()).toBe(false);
    expect(form.getFieldProps("groupName").error).toBe("Укажите имя группы");
    expect(form.getFieldProps("nodeId").error).toBe("Выберите ноду");
  });

  it("не принимает имя из одних пробелов", async () => {
    const form = validGroup();
    form.groupName = "   ";

    expect(await form.validate()).toBe(false);
    expect(form.getFieldProps("groupName").error).toBe("Укажите имя группы");
  });

  it("ограничивает имя группы 120 символами", async () => {
    const form = validGroup();
    form.groupName = "g".repeat(GROUP_NAME_MAX_LENGTH + 1);

    expect(await form.validate()).toBe(false);
    expect(form.getFieldProps("groupName").error).toBe(
      `Имя группы: не длиннее ${GROUP_NAME_MAX_LENGTH} символов`,
    );

    form.groupName = "g".repeat(GROUP_NAME_MAX_LENGTH);
    expect(await form.validate()).toBe(true);
  });

  it("ограничивает описание группы 500 символами", async () => {
    const form = validGroup();
    form.groupDescription = "d".repeat(GROUP_DESCRIPTION_MAX_LENGTH + 1);

    expect(await form.validate()).toBe(false);
    expect(form.getFieldProps("groupDescription").error).toBe(
      `Описание: не длиннее ${GROUP_DESCRIPTION_MAX_LENGTH} символов`,
    );

    form.groupDescription = "d".repeat(GROUP_DESCRIPTION_MAX_LENGTH);
    expect(await form.validate()).toBe(true);
  });

  it.each(["999.1.1.1/24", "10.8.0.0/33", "10.8.0.0", "10.8.0/24", "abc"])(
    "отклоняет CIDR %s",
    async (cidr) => {
      const form = validGroup();
      form.baseCidr = cidr;

      expect(await form.validate()).toBe(false);
      expect(form.getFieldProps("baseCidr").error).toBe("Некорректный CIDR");
    },
  );

  it("принимает корректный IPv4 CIDR", async () => {
    const form = validGroup();
    form.baseCidr = "192.168.1.0/24";

    expect(await form.validate()).toBe(true);
    expect(form.isReady).toBe(true);
  });

  it("не требует владельца группы", async () => {
    const form = validGroup();
    form.ownerUserId = "";

    expect(await form.validate()).toBe(true);
  });
});

describe("ClientsImportForm", () => {
  it("не требует владельца и интерфейс, но требует конфиги", async () => {
    const form = clients();

    expect(await form.validate()).toBe(false);
    expect(form.getFieldProps("clientOwnerUserId").error).toBeUndefined();
    expect(form.getFieldProps("clientInterfaceId").error).toBeUndefined();
    expect(form.getFieldProps("clientsImportText").error).toBe(
      "Добавьте хотя бы один корректный конфиг устройства",
    );
  });

  it("принимает пустые владельца и интерфейс", async () => {
    const form = clients();
    form.clientOwnerUserId = "";
    form.clientInterfaceId = "";
    form.clientsImportText = "[Interface]\nAddress = 10.8.0.2/24";

    expect(await form.validate()).toBe(true);
    expect(form.clientOwnerUserId).toBe("");
    expect(form.clientInterfaceId).toBe("");
  });

  it("отклоняет текст без конфигов", async () => {
    const form = validClients();
    form.clientsImportText = "  \n---\n---\n ";

    expect(await form.validate()).toBe(false);
    expect(form.getFieldProps("clientsImportText").error).toBe(
      "Добавьте хотя бы один корректный конфиг устройства",
    );
  });

  it("принимает текст с несколькими конфигами", async () => {
    const form = validClients();
    form.clientsImportText = [
      "[Interface]\nAddress = 10.8.0.2/24",
      "---",
      "[Interface]\nAddress = 10.8.0.3/24",
    ].join("\n");

    expect(await form.validate()).toBe(true);
    expect(form.clientOwnerUserId).toBe("u1");
  });

  it("parsesClients разбирает тот же формат, что и импорт", () => {
    expect(parsesClients("")).toBe(false);
    expect(parsesClients("---")).toBe(false);
    expect(parsesClients("[Interface]\nAddress = 10.8.0.2/24")).toBe(true);
  });
});
