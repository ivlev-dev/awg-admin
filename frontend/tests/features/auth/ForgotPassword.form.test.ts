import { ForgotPasswordForm } from "@/features/auth/ForgotPassword.form";

describe("ForgotPasswordForm", () => {
  it("requires an email", async () => {
    const form = new ForgotPasswordForm();

    expect(await form.validate()).toBe(false);
    expect(form.getFieldProps("email").error).toBe("Введите корректный email");
  });

  it("rejects an invalid email", async () => {
    const form = new ForgotPasswordForm();
    form.getFieldProps("email").setValue("user@");

    expect(await form.validate()).toBe(false);
    expect(form.getFieldProps("email").error).toBe("Введите корректный email");
  });

  it("accepts an email without a TLD", async () => {
    const form = new ForgotPasswordForm();
    form.getFieldProps("email").setValue("admin@local");

    expect(await form.validate()).toBe(true);
    expect(form.getFieldProps("email").error).toBeUndefined();
  });
});
