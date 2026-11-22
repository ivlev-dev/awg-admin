import { LoginForm } from "@/features/auth/Login.form";
import { setLocale } from "@/i18n";

function fill(form: LoginForm): void {
  form.getFieldProps("email").setValue("admin@example.com");
  form.getFieldProps("password").setValue("secret");
}

describe("LoginForm", () => {
  it("requires an email and a password", async () => {
    const form = new LoginForm();

    expect(await form.validate()).toBe(false);
    expect(form.getFieldProps("email").error).toBe("Введите корректный email");
    expect(form.getFieldProps("password").error).toBeDefined();
  });

  it("rejects an email without a domain part", async () => {
    const form = new LoginForm();
    form.getFieldProps("email").setValue("admin");
    form.getFieldProps("password").setValue("secret");

    expect(await form.validate()).toBe(false);
    expect(form.getFieldProps("email").error).toBe("Введите корректный email");
  });

  it("accepts an email without a TLD because the backend allows admin@local", async () => {
    const form = new LoginForm();
    form.getFieldProps("email").setValue("admin@local");
    form.getFieldProps("password").setValue("secret");

    expect(await form.validate()).toBe(true);
    expect(form.getFieldProps("email").error).toBeUndefined();
  });

  it("does not validate the TOTP field before the second step", async () => {
    const form = new LoginForm();
    fill(form);

    expect(await form.validate()).toBe(true);
    expect(form.getFieldProps("totpCode").error).toBeUndefined();
  });

  it("requires a valid TOTP code on the second step", async () => {
    const form = new LoginForm();
    fill(form);
    form.totpRequired = true;

    expect(await form.validate()).toBe(false);
    expect(form.getFieldProps("totpCode").error).toBe(
      "Неверный код двухфакторной аутентификации.",
    );

    form.getFieldProps("totpCode").setValue("12");
    expect(await form.validate()).toBe(false);
    expect(form.getFieldProps("totpCode").error).toBe(
      "Неверный код двухфакторной аутентификации.",
    );

    form.getFieldProps("totpCode").setValue("123456");
    expect(await form.validate()).toBe(true);
    expect(form.getFieldProps("totpCode").error).toBeUndefined();
  });

  it("accepts a recovery code on the second step", async () => {
    const form = new LoginForm();
    fill(form);
    form.totpRequired = true;
    form.getFieldProps("totpCode").setValue("abcd-1234");

    expect(await form.validate()).toBe(true);
  });

  it("clears TOTP errors when the step is deactivated", async () => {
    const form = new LoginForm();
    fill(form);
    form.totpRequired = true;
    await form.validate();
    expect(form.getFieldProps("totpCode").error).toBeDefined();

    form.totpRequired = false;
    form.getFieldProps("totpCode").setValue("");
    expect(await form.validate()).toBe(true);
    expect(form.getFieldProps("totpCode").error).toBeUndefined();
  });

  it("follows the interface locale for built-in messages", async () => {
    try {
      setLocale("en");
      const form = new LoginForm();

      expect(await form.validate()).toBe(false);
      expect(form.getFieldProps("password").error).toContain("is required");
    } finally {
      setLocale("ru");
    }
  });

  it("validates an email on input while the form stays idle", async () => {
    const form = new LoginForm();
    form.getFieldProps("email").onInput({ currentTarget: { value: "nope" } });

    await vi.waitFor(() => {
      expect(form.getFieldProps("email").error).toBe("Введите корректный email");
    });
    expect(form.getFieldProps("email").touched).toBe(false);
  });
});
