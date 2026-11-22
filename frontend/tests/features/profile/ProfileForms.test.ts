import { FullNameForm } from "@/features/profile/full-name.form";
import { PasswordForm } from "@/features/profile/password.form";
import {
  TotpDisableForm,
  TotpEnableForm,
  TotpSetupForm,
} from "@/features/profile/totp.form";

const FORMS: Array<{ dispose(): void }> = [];

function passwordForm(email = "admin@example.com"): PasswordForm {
  const form = new PasswordForm(email);
  FORMS.push(form);
  return form;
}

function fullNameForm(value = ""): FullNameForm {
  const form = new FullNameForm(value);
  FORMS.push(form);
  return form;
}

function setupForm(): TotpSetupForm {
  const form = new TotpSetupForm();
  FORMS.push(form);
  return form;
}

function enableForm(): TotpEnableForm {
  const form = new TotpEnableForm();
  FORMS.push(form);
  return form;
}

function disableForm(): TotpDisableForm {
  const form = new TotpDisableForm();
  FORMS.push(form);
  return form;
}

afterEach(() => {
  for (const form of FORMS.splice(0)) form.dispose();
});

describe("PasswordForm", () => {
  it("требует текущий пароль", async () => {
    const form = passwordForm();
    form.getFieldProps("nextPassword").setValue("new-password");
    form.getFieldProps("repeatPassword").setValue("new-password");

    await expect(form.validate()).resolves.toBe(false);
    expect(form.getFieldProps("currentPassword").error).toBe(
      "Введите текущий пароль",
    );
  });

  it("требует новый пароль минимальной длины", async () => {
    const form = passwordForm();
    form.getFieldProps("currentPassword").setValue("old-password");
    form.getFieldProps("nextPassword").setValue("123456789");
    form.getFieldProps("repeatPassword").setValue("123456789");

    await expect(form.validate()).resolves.toBe(false);
    expect(form.getFieldProps("nextPassword").error).toBe(
      "Новый пароль должен содержать минимум 10 символов",
    );
  });

  it("отклоняет простой пароль и пароль из email", async () => {
    const form = passwordForm("VeryLongLocal@example.com");
    form.getFieldProps("currentPassword").setValue("old-password");

    form.getFieldProps("nextPassword").setValue("1234567890");
    form.getFieldProps("repeatPassword").setValue("1234567890");
    await expect(form.validate()).resolves.toBe(false);
    expect(form.getFieldProps("nextPassword").error).toBe(
      "Пароль слишком простой. Используйте более сложный пароль.",
    );

    form.getFieldProps("nextPassword").setValue("verylonglocal");
    form.getFieldProps("repeatPassword").setValue("verylonglocal");
    await expect(form.validate()).resolves.toBe(false);
    expect(form.getFieldProps("nextPassword").error).toBe(
      "Пароль не должен совпадать с частью email до @",
    );
  });

  it("требует совпадения повторного пароля", async () => {
    const form = passwordForm();
    form.getFieldProps("currentPassword").setValue("old-password");
    form.getFieldProps("nextPassword").setValue("new-password");
    form.getFieldProps("repeatPassword").setValue("another-password");

    await expect(form.validate()).resolves.toBe(false);
    expect(form.getFieldProps("repeatPassword").error).toBe("Пароли не совпадают");
  });

  it("пропускает корректные значения", async () => {
    const form = passwordForm();
    form.getFieldProps("currentPassword").setValue("old-password");
    form.getFieldProps("nextPassword").setValue("new-password");
    form.getFieldProps("repeatPassword").setValue("new-password");

    await expect(form.validate()).resolves.toBe(true);
    expect(form.isValid).toBe(true);
    expect(form.isDirty).toBe(true);
  });
});

describe("FullNameForm", () => {
  it("требует непустое ФИО и ограничивает длину", async () => {
    const form = fullNameForm();

    await expect(form.validate()).resolves.toBe(false);
    expect(form.getFieldProps("fullName").error).toBe("ФИО не может быть пустым");

    form.getFieldProps("fullName").setValue("a".repeat(201));
    await expect(form.validate()).resolves.toBe(false);
    expect(form.getFieldProps("fullName").error).toBe(
      "ФИО не должно быть длиннее 200 символов",
    );
  });

  it("пропускает корректное ФИО", async () => {
    const form = fullNameForm("Иван Петров");

    expect(form.getFieldProps("fullName").value).toBe("Иван Петров");
    expect(form.isDirty).toBe(false);
    await expect(form.validate()).resolves.toBe(true);
  });
});

describe("TotpSetupForm", () => {
  it("требует текущий пароль", async () => {
    const form = setupForm();

    await expect(form.validate()).resolves.toBe(false);
    expect(form.getFieldProps("password").error).toBe("Введите текущий пароль");

    form.getFieldProps("password").setValue("secret");
    await expect(form.validate()).resolves.toBe(true);
  });
});

describe("TotpEnableForm", () => {
  it("требует пароль и шестизначный код", async () => {
    const form = enableForm();

    await expect(form.validate()).resolves.toBe(false);
    expect(form.getFieldProps("password").error).toBe("Введите текущий пароль");
    expect(form.getFieldProps("code").error).toBe("Введите 6-значный код");

    form.getFieldProps("password").setValue("secret");
    form.getFieldProps("code").setValue("12");
    await expect(form.validate()).resolves.toBe(false);
    expect(form.getFieldProps("code").error).toBe("Введите 6-значный код");
  });

  it("принимает шестизначный код", async () => {
    const form = enableForm();
    form.getFieldProps("password").setValue("secret");
    form.getFieldProps("code").setValue("123456");

    await expect(form.validate()).resolves.toBe(true);
  });
});

describe("TotpDisableForm", () => {
  it("требует пароль и корректный код", async () => {
    const form = disableForm();

    await expect(form.validate()).resolves.toBe(false);
    expect(form.getFieldProps("password").error).toBe("Введите текущий пароль");
    expect(form.getFieldProps("code").error).toBe("Введите 6-значный код");

    form.getFieldProps("password").setValue("secret");
    form.getFieldProps("code").setValue("654321");
    await expect(form.validate()).resolves.toBe(true);
  });
});
