import { ResetPasswordForm } from "@/features/users/reset-password.form";

function formWith(password: string, email = "user@example.com"): ResetPasswordForm {
  const form = new ResetPasswordForm();
  form.targetEmail = email;
  form.newPassword = password;
  return form;
}

describe("ResetPasswordForm", () => {
  it("требует новый пароль", async () => {
    const form = formWith("");

    await form.validate();

    expect(form.getFieldProps("newPassword").error).toBeDefined();
  });

  it("требует минимум 10 символов", async () => {
    const form = formWith("short");

    await form.validate();

    expect(form.getFieldProps("newPassword").error).toBe(
      "Пароль должен содержать не менее 10 символов",
    );
  });

  it("ограничивает пароль 1024 символами", async () => {
    const form = formWith("a".repeat(1025));

    await form.validate();

    expect(form.getFieldProps("newPassword").error).toBe(
      "Пароль должен быть не длиннее 1024 символов",
    );
  });

  it("отклоняет простой пароль", async () => {
    const form = formWith("1234567890");

    await form.validate();

    expect(form.getFieldProps("newPassword").error).toBe(
      "Пароль слишком простой. Используйте более сложный пароль",
    );
  });

  it("отклоняет пароль, совпадающий с локальной частью email", async () => {
    const form = formWith("verylonglocal", "VeryLongLocal@example.com");

    await form.validate();

    expect(form.getFieldProps("newPassword").error).toBe(
      "Пароль не должен совпадать с частью email до @",
    );
  });

  it("принимает корректный пароль", async () => {
    const form = formWith("newsecret1");

    await expect(form.validate()).resolves.toBe(true);
  });

  it("показывает серверную ошибку", () => {
    const form = formWith("newsecret1");
    form.setFieldErrors("newPassword", "Сервер отклонил пароль");

    expect(form.getFieldProps("newPassword").error).toBe("Сервер отклонил пароль");
  });
});
