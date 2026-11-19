import { For, Show } from "@ivlev-dev/silent-core";

import type { ClientDetailsVM } from "../ClientDetails.vm";
import { t } from "@/i18n";

export function ClientForwardingSection(props: { vm: ClientDetailsVM }) {
  const vm = props.vm;
  return (
    <section class="card client-section" id="client-forwarding" tabindex={-1}>
      <div class="card__head">
        <div>
          <h2 class="card__title" tabindex={-1}>{t("clients.details.forwarding.matrix.title")}</h2>
          <div class="card__sub">
            {t("clients.details.forwarding.matrix.subtitle")}
          </div>
        </div>
        <label class="switch">
          <input
            type="checkbox"
            checked={vm.forwardingSymmetric}
            onChange={(event: Event) => vm.setForwardingSymmetric(event)}
          />
          <span class="track"></span>
          <span>{t("clients.details.forwarding.matrix.symmetric")}</span>
        </label>
      </div>
      <div class="card__body stack">
        <Show
          when={vm.forwardingMatrixReady}
          fallback={
            <div class="small muted">
              {t("clients.details.forwarding.matrix.needTwo")}
            </div>
          }
        >
          <Show when={vm.forwardingBulk}>
            <div class="alert alert--info">
              {t("clients.details.forwarding.matrix.bulk")}
            </div>
          </Show>

          <Show when={vm.forwardingBusy}>
            <div class="row xs muted" style="gap:8px;align-items:center">
              <span class="spinner" style="width:14px;height:14px"></span>
              <span>{t("clients.details.forwarding.matrix.saving")}</span>
            </div>
          </Show>

          <div class="table-wrap">
            <table class="table matrix-table">
              <thead>
                <tr>
                  <th>{t("clients.details.forwarding.matrix.source")}</th>
                  <For each={vm.forwardingRows}>
                    {(column) => (
                      <th title={column.addresses.join(", ")}>{column.name}</th>
                    )}
                  </For>
                </tr>
              </thead>
              <tbody>
                <For each={vm.forwardingRows}>
                  {(row) => (
                    <tr>
                      <td>
                        <div class="stack-sm">
                          <span class="small strong">{row.name}</span>
                          <select
                            class="select matrix-mode"
                            aria-label={t("clients.details.forwarding.matrix.rowMode", { name: row.name })}
                            onChange={(event: Event) => {
                              void vm.setForwardingRowMode(
                                row.id,
                                (event.target as HTMLSelectElement).value,
                              );
                            }}
                          >
                            <For each={vm.forwardingModeOptions}>
                              {(option) => (
                                <option value={option.value} selected={option.value === row.mode}>
                                  {option.label}
                                </option>
                              )}
                            </For>
                          </select>
                          <span class="xs mono muted">{row.addresses.join(", ")}</span>
                        </div>
                      </td>
                      <For each={vm.forwardingRows}>
                        {(column) => (
                          <td class="matrix-cell">
                            <Show when={row.id !== column.id} fallback={<span class="xs muted">—</span>}>
                              <input
                                type="checkbox"
                                checked={vm.isForwardingCellChecked(row.id, column.id)}
                                disabled={vm.isForwardingCellDisabled(row.id, column.id)}
                                title={vm.forwardingPairTitle(row.id, column.id)}
                                aria-label={vm.forwardingPairTitle(row.id, column.id)}
                                onChange={() => {
                                  void vm.toggleForwardingCell(row.id, column.id);
                                }}
                              />
                            </Show>
                          </td>
                        )}
                      </For>
                    </tr>
                  )}
                </For>
              </tbody>
            </table>
          </div>

          <div class="forwarding-pairs">
            <div class="xs muted">{t("clients.details.forwarding.matrix.pairs")}</div>
            <For each={vm.forwardingPairs}>
              {(pair) => (
                <label class="checkbox">
                  <input
                    type="checkbox"
                    checked={pair.allowed}
                    disabled={pair.disabled}
                    onChange={() => {
                      void vm.toggleForwardingPair(pair.aId, pair.bId);
                    }}
                  />
                  <span>
                    {pair.label} — {pair.detail}
                  </span>
                </label>
              )}
            </For>
          </div>
        </Show>
      </div>
    </section>
  );
}
