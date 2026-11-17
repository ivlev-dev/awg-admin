import {
  Match,
  Switch,
  computed,
  createComponent,
  createSignal,
  flushSync,
} from "@ivlev-dev/silent-core";

const [mode, setMode] = createSignal("idle");
const [vmStatus, setVmStatus] = createSignal("idle");

function SignalSwitch() {
  return (
    <Switch fallback={<div class="idle">idle</div>}>
      <Match when={mode() === "ready"}>
        <div class="ready">ready</div>
      </Match>
      <Match when={mode() === "error"}>
        <div class="error">error</div>
      </Match>
    </Switch>
  );
}

class SwitchVM {
  @computed
  get isReady(): boolean {
    return vmStatus() === "ready";
  }
}

function VmSwitch(this: { vm: SwitchVM }) {
  return (
    <Switch fallback={<div class="vm-idle">idle</div>}>
      <Match when={this.vm.isReady}>
        <div class="vm-ready">ready</div>
      </Match>
    </Switch>
  );
}

describe("Switch", () => {
  afterEach(() => {
    document.body.replaceChildren();
    setMode("idle");
    setVmStatus("idle");
  });

  it("переключает ветку по сигналу в when", async () => {
    const result = createComponent(SignalSwitch, {});
    document.body.appendChild(result.node);
    await result.ready;

    expect(document.querySelector(".idle")).not.toBeNull();

    setMode("ready");
    flushSync();
    expect(document.querySelector(".ready")).not.toBeNull();
    expect(document.querySelector(".idle")).toBeNull();

    setMode("error");
    flushSync();
    expect(document.querySelector(".error")).not.toBeNull();
    expect(document.querySelector(".ready")).toBeNull();

    result.dispose();
  });

  it("переключает ветку по computed в when", async () => {
    const result = createComponent(VmSwitch, {});
    document.body.appendChild(result.node);
    await result.ready;

    expect(document.querySelector(".vm-idle")).not.toBeNull();

    setVmStatus("ready");
    flushSync();
    expect(document.querySelector(".vm-ready")).not.toBeNull();
    expect(document.querySelector(".vm-idle")).toBeNull();

    result.dispose();
  });
});
