import { createComponent } from "@ivlev-dev/silent-core";

import { createAppContainer } from "@/app/di";
import { setLocale } from "@/i18n";
import { Login } from "./Login";

describe("Login i18n", () => {
  afterEach(() => {
    setLocale("ru");
  });

  it("перерисовывает заголовки, поля и кнопки при смене языка", async () => {
    const container = createAppContainer();
    const result = createComponent(Login, {}, { container });
    await result.ready;

    expect(result.node.textContent).toContain("Вход в систему");
    expect(result.node.textContent).toContain("Логин");
    expect(result.node.textContent).toContain("Пароль");
    expect(result.node.textContent).toContain("Войти");

    setLocale("en");

    await vi.waitFor(() => {
      expect(result.node.textContent).toContain("Sign in");
      expect(result.node.textContent).toContain("Username");
      expect(result.node.textContent).toContain("Password");
    });

    result.dispose();
  });
});
