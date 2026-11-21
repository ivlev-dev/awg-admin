import { createComponent } from "@ivlev-dev/silent-core";

import { ErrorState } from "@/components/ErrorState";

function find(root: Node, selector: string): Element | null {
  if (root instanceof Element && root.matches(selector)) return root;
  return (root as ParentNode).querySelector(selector);
}

afterEach(() => {
  document.body.replaceChildren();
});

describe("ErrorState", () => {
  it("показывает сообщение об ошибке с иконкой предупреждения", () => {
    const result = createComponent(ErrorState, { message: "Сервис недоступен" });

    expect(result.node.textContent).toContain("Сервис недоступен");
    expect(find(result.node, ".alert.alert--error.alert--with-action")).not.toBeNull();
    expect(find(result.node, "svg")).not.toBeNull();

    result.dispose();
  });

  it("вызывает onRetry по нажатию на кнопку повтора", () => {
    const onRetry = vi.fn();
    const result = createComponent(ErrorState, { message: "Ошибка", onRetry });
    document.body.appendChild(result.node);

    const button = find(result.node, "button.btn.btn--sm");
    if (!(button instanceof HTMLButtonElement)) throw new Error("Кнопка повтора не найдена");
    expect(button.type).toBe("button");
    expect(button.textContent).toBe("Повторить");

    button.click();

    expect(onRetry).toHaveBeenCalledTimes(1);

    result.dispose();
  });

  it("не показывает кнопку без onRetry", () => {
    const result = createComponent(ErrorState, { message: "Ошибка" });

    expect(find(result.node, "button")).toBeNull();

    result.dispose();
  });
});
