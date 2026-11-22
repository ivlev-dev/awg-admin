import { ResetPasswordForm } from "@/features/auth/ResetPassword.form";

function setValues(form: ResetPasswordForm, password: string, repeat: string): void {
  form.getFieldProps("password").setValue(password);
  form.getFieldProps("repeatPassword").setValue(repeat);
}

describe("ResetPasswordForm", () => {
  it("requires both password fields", async () => {
    const form = new ResetPasswordForm();

    expect(await form.validate()).toBe(false);
    expect(form.getFieldProps("password").error).toBe(
      "Пароль должен содержать минимум 10 символов",
    );
    expect(form.getFieldProps("repeatPassword").error).toBe("Пароли не совпадают");
  });

  it("rejects a password shorter than 10 characters", async () => {
    const form = new ResetPasswordForm();
    setValues(form, "123456789", "123456789");

    expect(await form.validate()).toBe(false);
    expect(form.getFieldProps("password").error).toBe(
      "Пароль должен содержать минимум 10 символов",
    );
  });

  it("rejects a password longer than 1024 characters", async () => {
    const form = new ResetPasswordForm();
    const long = "a".repeat(1025);
    setValues(form, long, long);

    expect(await form.validate()).toBe(false);
    expect(form.getFieldProps("password").error).toBe(
      "Пароль должен быть не длиннее 1024 символов",
    );
  });

  it("rejects a common password", async () => {
    const form = new ResetPasswordForm();
    setValues(form, "letmein123", "letmein123");

    expect(await form.validate()).toBe(false);
    expect(form.getFieldProps("password").error).toBe(
      "Пароль слишком простой. Используйте более сложный пароль.",
    );
  });

  it("rejects mismatched passwords", async () => {
    const form = new ResetPasswordForm();
    setValues(form, "secret1234", "secret12345");

    expect(await form.validate()).toBe(false);
    expect(form.getFieldProps("repeatPassword").error).toBe("Пароли не совпадают");
  });

  it("accepts a valid password pair", async () => {
    const form = new ResetPasswordForm();
    setValues(form, "secret1234", "secret1234");

    expect(await form.validate()).toBe(true);
    expect(form.errors).toEqual({});
  });

  it("allows the password to repeat the email local part because reset has no email", async () => {
    const form = new ResetPasswordForm();
    setValues(form, "verylonglocal", "verylonglocal");

    expect(await form.validate()).toBe(true);
  });
});
