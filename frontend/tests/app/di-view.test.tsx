import { createComponent } from "@ivlev-dev/silent-core";

import type { AuthService } from "@/application/auth/service";
import { createAppContainer } from "@/app/di";

class DiProbeVM {
  constructor(private readonly auth: AuthService) {}

  get label(): string {
    return this.auth.constructor.name;
  }
}

function DiProbe(this: { vm: DiProbeVM }) {
  return <div class="di-probe">{this.vm.label}</div>;
}

describe("constructor DI in views", () => {
  it("resolves a ViewModel with constructor dependencies through the container", async () => {
    const container = createAppContainer();
    const result = createComponent(DiProbe, {}, { container });
    await result.ready;
    expect(result.node.textContent).toBe("DefaultAuthService");
  });
});
