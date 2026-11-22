import { RegisterForm } from "@/features/auth/Register.form";

function setValues(
  form: RegisterForm,
  values: Partial<Record<"email" | "fullName" | "password" | "repeatPassword", string>>,
): void {
  for (const [field, value] of Object.entries(values)) {
    form.getFieldProps(field as "email").setValue(value);
  }
}

function validForm(): RegisterForm {
  const form = new RegisterForm();
  setValues(form, {
    email: "user@example.com",
    password: "secret1234",
    repeatPassword: "secret1234",
  });
  return form;
}

describe("RegisterForm", () => {
  it("requires email, password and confirmation", async () => {
    const form = new RegisterForm();

    expect(await form.validate()).toBe(false);
    expect(form.getFieldProps("email").error).toBe("Введите корректный email");
    expect(form.getFieldProps("password").error).toBe(
      "Пароль должен содержать минимум 10 символов",
    );
    expect(form.getFieldProps("repeatPassword").error).toBe("Пароли не совпадают");
  });

  it("rejects an invalid email", async () => {
    const form = new RegisterForm();
    setValues(form, {
      email: "nope",
      password: "secret1234",
      repeatPassword: "secret1234",
    });

    expect(await form.validate()).toBe(false);
    expect(form.getFieldProps("email").error).toBe("Введите корректный email");
  });

  it("accepts an email without a TLD because the backend allows admin@local", async () => {
    const form = new RegisterForm();
    setValues(form, {
      email: "admin@local",
      password: "secret1234",
      repeatPassword: "secret1234",
    });

    expect(await form.validate()).toBe(true);
  });

  it("rejects a password shorter than 10 characters", async () => {
    const form = new RegisterForm();
    setValues(form, {
      email: "user@example.com",
      password: "123456789",
      repeatPassword: "123456789",
    });

    expect(await form.validate()).toBe(false);
    expect(form.getFieldProps("password").error).toBe(
      "Пароль должен содержать минимум 10 символов",
    );
  });

  it("rejects a password longer than 1024 characters", async () => {
    const form = new RegisterForm();
    setValues(form, {
      email: "user@example.com",
      password: "a".repeat(1025),
      repeatPassword: "a".repeat(1025),
    });

    expect(await form.validate()).toBe(false);
    expect(form.getFieldProps("password").error).toBe(
      "Пароль должен быть не длиннее 1024 символов",
    );
  });

  it("rejects a common password", async () => {
    const form = new RegisterForm();
    setValues(form, {
      email: "user@example.com",
      password: "letmein123",
      repeatPassword: "letmein123",
    });

    expect(await form.validate()).toBe(false);
    expect(form.getFieldProps("password").error).toBe(
      "Пароль слишком простой. Используйте более сложный пароль.",
    );
  });

  it("rejects a password that repeats the email local part", async () => {
    const form = new RegisterForm();
    setValues(form, {
      email: "VeryLongLocal@example.com",
      password: "verylonglocal",
      repeatPassword: "verylonglocal",
    });

    expect(await form.validate()).toBe(false);
    expect(form.getFieldProps("password").error).toBe(
      "Пароль не должен совпадать с частью email до @",
    );
  });

  it("rejects mismatched passwords", async () => {
    const form = new RegisterForm();
    setValues(form, {
      email: "user@example.com",
      password: "secret1234",
      repeatPassword: "secret12345",
    });

    expect(await form.validate()).toBe(false);
    expect(form.getFieldProps("repeatPassword").error).toBe("Пароли не совпадают");
  });

  it("rejects a full name longer than 200 characters", async () => {
    const form = new RegisterForm();
    setValues(form, {
      email: "user@example.com",
      fullName: "a".repeat(201),
      password: "secret1234",
      repeatPassword: "secret1234",
    });

    expect(await form.validate()).toBe(false);
    expect(form.getFieldProps("fullName").error).toBe(
      "ФИО должно быть не длиннее 200 символов",
    );
  });

  it("accepts an empty full name and valid credentials", async () => {
    const form = validForm();

    expect(await form.validate()).toBe(true);
    expect(form.getFieldProps("fullName").error).toBeUndefined();
  });

  it("accepts a trimmed full name of exactly 200 characters", async () => {
    const form = validForm();
    form.getFieldProps("fullName").setValue("a".repeat(200));

    expect(await form.validate()).toBe(true);
  });
});
