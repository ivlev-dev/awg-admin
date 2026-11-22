import { Show } from "@ivlev-dev/silent-core";

import type { ClientDetailsVM } from "../ClientDetails.vm";
import { Icon } from "@/components/Icon";
import { Modal } from "@/components/Modal";
import { QrCode } from "@/components/QrCode";
import { Select } from "@/components/Select";
import { t } from "@/i18n";

export function ClientQrDialog(props: { vm: ClientDetailsVM }) {
  const vm = props.vm;
  return (
    <Modal
      open={vm.qrOpen}
      title={vm.qrTitle}
      onClose={() => vm.closeQr()}
      footer={
        <button class="btn btn--primary" type="button" onClick={() => vm.copyQrValue()}>
          <Icon name="copy" size={14} class="" /> {vm.qrCopyLabel}
        </button>
      }
    >
      <div class="stack" style="align-items:center;gap:12px">
        <QrCode
          value={vm.qrValue}
          size={340}
          label={t("clients.details.qr.aria")}
          loadingLabel={t("clients.details.qr.loading")}
          errorLabel={t("clients.details.qr.error")}
          limitLabel={t("clients.details.qr.limit")}
        />
        <div class="hint" style="text-align:center">{t("clients.details.qr.hint")}</div>
      </div>
    </Modal>
  );
}

export function ClientAddTunnelDialog(props: { vm: ClientDetailsVM }) {
  const vm = props.vm;
  const labelField = vm.tunnelForm.getFieldProps("addLabel");
  return (
    <Modal
      open={vm.addTunnelOpen}
      title={t("clients.details.tunnels.addTitle")}
      onClose={() => vm.closeAddTunnel()}
      footer={
        <>
          <button
            class="btn"
            type="button"
            disabled={vm.addTunnelBusy}
            onClick={() => vm.closeAddTunnel()}
          >
            {t("common.cancelShort")}
          </button>
          <button
            class="btn btn--primary"
            type="submit"
            form="tunnel-add"
            disabled={!vm.canAddTunnel}
          >
            {vm.addTunnelBusy
              ? t("clients.details.tunnels.adding")
              : t("clients.details.tunnels.addAction")}
          </button>
        </>
      }
    >
      <form
        id="tunnel-add"
        class="stack"
        onSubmit={(event: Event) => {
          event.preventDefault();
          void vm.addTunnel();
        }}
      >
        <div class="field">
          <label for="tunnel-interface">{t("clients.details.tunnels.interface")}</label>
          <Select
            id="tunnel-interface"
            value={vm.addTunnelInterfaceId}
            options={vm.tunnelInterfaceOptions.map((option) => ({
              value: option.value,
              label: option.label,
            }))}
            disabled={vm.addTunnelInterfaceLocked}
            onChange={(value) => vm.setAddTunnelInterface(value)}
            ariaLabel={t("clients.details.tunnels.interface")}
          />
          <div class="hint">{t("clients.details.tunnels.interfaceHint")}</div>
        </div>
        <div class="field">
          <label for="tunnel-label">{t("clients.details.tunnels.label")}</label>
          <input
            id="tunnel-label"
            class="input"
            type="text"
            maxlength={64}
            autocomplete="off"
            value={labelField.value}
            aria-invalid={vm.addTunnelLabelError !== null}
            onInput={(event: Event) => vm.setAddTunnelLabel(event)}
            onBlur={labelField.onBlur}
          />
          <div class={vm.addTunnelLabelError ? "hint hint--error" : "hint"}>
            {vm.addTunnelLabelError ?? t("clients.details.tunnels.labelHint")}
          </div>
        </div>
      </form>
    </Modal>
  );
}

export function ClientRenameTunnelDialog(props: { vm: ClientDetailsVM }) {
  const vm = props.vm;
  const labelField = vm.tunnelForm.getFieldProps("renameLabel");
  return (
    <Modal
      open={vm.renameTunnelOpen}
      title={t("clients.details.tunnels.renameTitle")}
      onClose={() => vm.closeRenameTunnel()}
      footer={
        <>
          <button
            class="btn"
            type="button"
            disabled={vm.renameTunnelBusy}
            onClick={() => vm.closeRenameTunnel()}
          >
            {t("common.cancelShort")}
          </button>
          <button
            class="btn btn--primary"
            type="submit"
            form="tunnel-rename"
            disabled={!vm.canRenameTunnel}
          >
            {vm.renameTunnelBusy
              ? t("common.saving")
              : t("clients.details.tunnels.renameAction")}
          </button>
        </>
      }
    >
      <form
        id="tunnel-rename"
        class="stack"
        onSubmit={(event: Event) => {
          event.preventDefault();
          void vm.renameTunnel();
        }}
      >
        <div class="field">
          <label for="tunnel-rename-label">{t("clients.details.tunnels.label")}</label>
          <input
            id="tunnel-rename-label"
            class="input"
            type="text"
            maxlength={64}
            autocomplete="off"
            value={labelField.value}
            aria-invalid={vm.renameTunnelLabelError !== null}
            onInput={(event: Event) => vm.setRenameTunnelLabel(event)}
            onBlur={labelField.onBlur}
          />
          <div class={vm.renameTunnelLabelError ? "hint hint--error" : "hint"}>
            {vm.renameTunnelLabelError ?? t("clients.details.tunnels.labelHint")}
          </div>
        </div>
      </form>
    </Modal>
  );
}
