import { Match, Switch } from "@ivlev-dev/silent-core";

import type { QrCodeProps, QrCodeVm } from "./QrCode.vm";

export type { QrCodeProps } from "./QrCode.vm";

export function QrCode(this: { vm: QrCodeVm }, props: QrCodeProps) {
  return (
    <div class="qr-code" style={`--qr-size:${this.vm.sizePx}px`}>
      <Switch
        fallback={
          <div class="qr-code__placeholder skeleton" aria-hidden="true">
            <span class="qr-code__spinner spinner"></span>
          </div>
        }
      >
        <Match when={this.vm.status === "ready"}>
          <svg
            class="qr-code__svg"
            xmlns="http://www.w3.org/2000/svg"
            viewBox={`0 0 ${this.vm.dimension} ${this.vm.dimension}`}
            width={this.vm.sizePx}
            height={this.vm.sizePx}
            role="img"
            aria-label={this.vm.ariaLabel}
            shape-rendering="crispEdges"
          >
            <rect x="0" y="0" width={this.vm.dimension} height={this.vm.dimension} fill="#ffffff" />
            <path d={this.vm.path} fill="#000000" />
          </svg>
        </Match>
        <Match when={this.vm.status === "error"}>
          <div class="qr-code__error" role="alert">
            {this.vm.errorText}
          </div>
        </Match>
        <Match when={this.vm.status === "limit"}>
          <div class="qr-code__error" role="alert">
            {this.vm.limitText}
          </div>
        </Match>
        <Match when={this.vm.status === "loading" || this.vm.status === "idle"}>
          <div class="qr-code__placeholder skeleton" role="status" aria-label={this.vm.loadingLabel}>
            <span class="qr-code__spinner spinner"></span>
          </div>
        </Match>
      </Switch>
    </div>
  );
}
