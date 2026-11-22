import { NodeForm } from "@/features/nodes/node.form";

describe("NodeForm", () => {
  it("требует имя ноды", async () => {
    const form = new NodeForm();

    expect(await form.validate()).toBe(false);
    expect(form.getFieldProps("name").error).toBe("Имя ноды обязательно");
    expect(form.isReady).toBe(false);
  });

  it("отклоняет имя из одних пробелов", async () => {
    const form = new NodeForm();
    form.getFieldProps("name").setValue("   ");

    expect(await form.validate()).toBe(false);
    expect(form.getFieldProps("name").error).toBe("Имя ноды обязательно");
  });

  it("ограничивает имя 64 символами", async () => {
    const form = new NodeForm();
    form.getFieldProps("name").setValue("n".repeat(65));

    expect(await form.validate()).toBe(false);
    expect(form.getFieldProps("name").error).toBe("Имя ноды — не более 64 символов");

    form.getFieldProps("name").setValue("n".repeat(64));
    expect(await form.validate()).toBe(true);
    expect(form.isReady).toBe(true);
  });

  it("принимает произвольное непустое имя", async () => {
    const form = new NodeForm();
    form.getFieldProps("name").setValue("eu-west-1");

    expect(await form.validate()).toBe(true);
    expect(form.getFieldProps("name").error).toBeUndefined();
  });

  it("сбрасывает ошибки и touched через reset", async () => {
    const form = new NodeForm();
    const name = form.getFieldProps("name");
    name.onBlur();
    await form.validate();
    expect(name.error).toBeDefined();

    form.reset();

    expect(name.error).toBeUndefined();
    expect(name.touched).toBe(false);
    expect(form.name).toBe("");
  });
});
