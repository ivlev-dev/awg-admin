import { createComponent, whenIdle } from "@ivlev-dev/silent-core";
import { Container } from "@ivlev-dev/silent-di";
import { RouterView, createTestRouter } from "@ivlev-dev/silent-router";

class Marker {
  constructor(readonly value: string) {}
}

class PageVM {
  constructor(private readonly marker: Marker) {}

  get label(): string {
    return this.marker.value;
  }
}

function Page(this: { vm: PageVM }) {
  return <div class="page">{this.vm.label}</div>;
}

function OtherPage(this: { vm: PageVM }) {
  return <div class="other-page">{this.vm.label}</div>;
}

function mountView(props: Record<string, unknown>, container: Container): { readonly dispose: () => void } {
  const host = document.createElement("div");
  document.body.appendChild(host);
  const result = createComponent(RouterView, props, { container });
  host.appendChild(result.node);
  return {
    dispose: () => {
      result.dispose();
      host.remove();
    },
  };
}

describe("RouterView", () => {
  afterEach(() => {
    document.body.innerHTML = "";
  });

  it("передаёт контейнер в страницу маршрута", async () => {
    const container = new Container("router-view-test");
    container.bindValue(Marker, new Marker("bound"));
    const router = createTestRouter({
      routes: [{ path: "/", name: "home", component: Page }],
      container,
    });
    await router.start();

    const view = mountView({}, container);
    await vi.waitFor(() => {
      expect(document.querySelector(".page")?.textContent).toBe("bound");
    });

    view.dispose();
    router.dispose();
    container.dispose();
  });

  it("переключает view при смене маршрута", async () => {
    const container = new Container("router-view-switch");
    container.bindValue(Marker, new Marker("shared"));
    const router = createTestRouter({
      routes: [
        { path: "/", name: "home", component: Page },
        { path: "/other", name: "other", component: OtherPage },
      ],
      container,
    });
    await router.start();

    const view = mountView({}, container);
    await vi.waitFor(() => {
      expect(document.querySelector(".other-page")).toBeNull();
      expect(document.querySelector(".page")).not.toBeNull();
    });

    await router.navigate("/other");
    await whenIdle();
    expect(document.querySelector(".other-page")).not.toBeNull();

    view.dispose();
    router.dispose();
    container.dispose();
  });

  it("рендерит notFound-слот для неизвестного маршрута", async () => {
    const container = new Container("router-view-not-found");
    container.bindValue(Marker, new Marker("bound"));
    const router = createTestRouter({
      routes: [{ path: "/", name: "home", component: Page }],
      initial: "/missing",
      container,
    });
    await router.start().catch(() => undefined);

    const view = mountView({ notFound: <div class="not-found">404</div> }, container);
    await vi.waitFor(() => {
      expect(document.querySelector(".not-found")).not.toBeNull();
    });

    view.dispose();
    router.dispose();
    container.dispose();
  });
});
