import type { Role } from "@/domain/types";
import { UserForm } from "@/features/users/user.form";

interface UserFormValues {
  email?: string;
  fullName?: string;
  password?: string;
  role?: Role;
  tariffId?: string;
  nodeId?: string;
  disabled?: boolean;
}

function validCreate(overrides: UserFormValues = {}): UserForm {
  const form = new UserForm();
  form.creating = true;
  form.setValues({
    email: "user@example.com",
    fullName: "",
    password: "secret1234",
    role: "user",
    tariffId: "",
    nodeId: "",
    disabled: false,
    ...overrides,
  });
  return form;
}

describe("UserForm", () => {
  it("принимает корректные данные при создании", async () => {
    const form = validCreate();

    await expect(form.validate()).resolves.toBe(true);
    expect(form.getFieldProps("email").error).toBeUndefined();
    expect(form.getFieldProps("password").error).toBeUndefined();
  });

  it("требует email", async () => {
    const form = validCreate({ email: "" });

    await form.validate();

    expect(form.getFieldProps("email").error).toBe("Введите корректный email");
  });

  it("принимает внутренний email без TLD", async () => {
    const form = validCreate({ email: "admin@local" });

    await expect(form.validate()).resolves.toBe(true);
  });

  it("отклоняет email без @", async () => {
    const form = validCreate({ email: "not-an-email" });

    await form.validate();

    expect(form.getFieldProps("email").error).toBe("Введите корректный email");
  });

  it("ограничивает email 254 символами", async () => {
    const form = validCreate({ email: `${"a".repeat(246)}@example.com` });

    await form.validate();

    expect(form.getFieldProps("email").error).toContain("254");
  });

  it("не требует пароль при редактировании", async () => {
    const form = validCreate();
    form.creating = false;
    form.password = "";

    await expect(form.validate()).resolves.toBe(true);
  });

  it("требует пароль не короче 10 символов при создании", async () => {
    const form = validCreate({ password: "short" });

    await form.validate();

    expect(form.getFieldProps("password").error).toBe(
      "Пароль должен содержать не менее 10 символов",
    );
  });

  it("ограничивает пароль 1024 символами", async () => {
    const form = validCreate({ password: "a".repeat(1025) });

    await form.validate();

    expect(form.getFieldProps("password").error).toBe("Пароль должен быть не длиннее 1024 символов");
  });

  it("отклоняет простой пароль", async () => {
    const form = validCreate({ password: "1234567890" });

    await form.validate();

    expect(form.getFieldProps("password").error).toBe(
      "Пароль слишком простой. Используйте более сложный пароль",
    );
  });

  it("отклоняет пароль, совпадающий с локальной частью email", async () => {
    const form = validCreate({ email: "VeryLongLocal@example.com", password: "verylonglocal" });

    await form.validate();

    expect(form.getFieldProps("password").error).toBe(
      "Пароль не должен совпадать с частью email до @",
    );
  });

  it("не ограничивает необязательное ФИО, но проверяет длину", async () => {
    const form = validCreate({ fullName: "" });
    await expect(form.validate()).resolves.toBe(true);

    form.fullName = "a".repeat(201);
    await form.validate();
    expect(form.getFieldProps("fullName").error).toBe("ФИО должно быть не длиннее 200 символов");
  });

  it("разрешает только известные роли", async () => {
    const form = validCreate();
    form.role = "guest" as Role;

    await form.validate();

    expect(form.getFieldProps("role").error).toBeDefined();
  });

  it("не валидирует флаг disabled", async () => {
    const form = validCreate({ disabled: true });

    await expect(form.validate()).resolves.toBe(true);
  });

  it("показывает серверную ошибку поля и очищает её при изменении", async () => {
    const form = validCreate();
    form.setFieldErrors("email", "Email уже занят");

    expect(form.getFieldProps("email").error).toBe("Email уже занят");

    form.getFieldProps("email").setValue("other@example.com");

    expect(form.getFieldProps("email").error).toBeUndefined();
  });
});
