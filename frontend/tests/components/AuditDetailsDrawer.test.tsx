import { createComponent, createSignal, flushSync } from "@ivlev-dev/silent-core";
import type { ComponentResult } from "@ivlev-dev/silent-core";

import { AuditDetailsDrawer } from "@/components/AuditDetailsDrawer";
import type { AuditEntry } from "@/domain/audit/types";
import type { AuditRowView } from "@/features/audit/AuditPage.vm";
import { formatAuditRow } from "@/features/audit/AuditPage.vm";
import { setLocale } from "@/i18n";

const DETAILS = `{
  "reason": "policy validation failed",
  "payload": "${"a".repeat(200)}"
}`;

function entry(overrides: Partial<AuditEntry> = {}): AuditEntry {
  return {
    id: "e1",
    at: "2024-05-06T12:34:56Z",
    actor_id: "u1",
    actor_email: "admin@local",
    actor_login: "admin",
    action: "POST",
    entity: "devices",
    entity_id: "1234567890abcdef",
    status: 201,
    ip: "10.0.0.1",
    details: DETAILS,
    ...overrides,
  };
}

function row(overrides: Partial<AuditEntry> = {}): AuditRowView {
  return formatAuditRow(entry(overrides));
}

interface MountedDrawer {
  result: ComponentResult;
  setRow: (next: AuditRowView | null) => void;
  closes: () => number;
  copies: () => AuditRowView[];
}

const disposers: Array<() => void> = [];

async function mountDrawer(initial: AuditRowView | null): Promise<MountedDrawer> {
  const [rowSignal, setRowSignal] = createSignal<AuditRowView | null>(initial);
  let closeCalls = 0;
  const copied: AuditRowView[] = [];
  const result = createComponent(AuditDetailsDrawer, {
    get row() {
      return rowSignal();
    },
    onClose: () => {
      closeCalls += 1;
    },
    onCopy: (value: AuditRowView) => {
      copied.push(value);
    },
  });
  document.body.appendChild(result.node);
  disposers.push(result.dispose);
  await result.ready;
  flushSync();
  return {
    result,
    setRow: (next: AuditRowView | null) => {
      setRowSignal(next);
      flushSync();
    },
    closes: () => closeCalls,
    copies: () => copied,
  };
}

function drawer(): HTMLElement | null {
  return document.querySelector<HTMLElement>(".audit-drawer");
}

function closeButton(): HTMLButtonElement {
  const button = document.querySelector<HTMLButtonElement>(".audit-drawer__close");
  if (button === null) throw new Error("close button not found");
  return button;
}

function pressKey(target: EventTarget, key: string, shiftKey = false): KeyboardEvent {
  const event = new KeyboardEvent("keydown", { key, shiftKey, bubbles: true, cancelable: true });
  target.dispatchEvent(event);
  return event;
}

beforeEach(() => {
  setLocale("ru");
});

afterEach(() => {
  setLocale("ru");
  for (const dispose of disposers.splice(0)) dispose();
  document.body.replaceChildren();
  document.body.style.overflow = "";
});

describe("AuditDetailsDrawer", () => {
  it("рендерит полные данные события и диалоговые атрибуты", async () => {
    const mounted = await mountDrawer(row());

    const panel = drawer();
    expect(panel).not.toBeNull();
    expect(panel?.getAttribute("role")).toBe("dialog");
    expect(panel?.getAttribute("aria-modal")).toBe("true");
    expect(panel?.getAttribute("tabindex")).toBe("-1");

    const titleId = panel?.getAttribute("aria-labelledby");
    expect(titleId).not.toBeNull();
    expect(document.getElementById(titleId ?? "")?.textContent).toBe("Событие");

    const text = panel?.textContent ?? "";
    expect(text).toContain("admin");
    expect(text).toContain("u1");
    expect(text).toContain("POST");
    expect(text).toContain("devices");
    expect(text).toContain("1234567890abcdef");
    expect(text).toContain("201");
    expect(text).toContain("10.0.0.1");

    expect(document.querySelector(".audit-drawer__json")?.textContent).toBe(DETAILS);
    expect(document.querySelector(".status-chip")?.className).toBe("status-chip status-chip--ok");

    mounted.setRow(null);
    expect(drawer()).toBeNull();
  });

  it("показывает прочерк и блокирует копирование без деталей", async () => {
    const mounted = await mountDrawer(row({ details: null }));

    expect(document.querySelector(".audit-drawer__json")?.textContent).toBe("—");
    const copy = document.querySelector<HTMLButtonElement>(".audit-drawer__copy");
    expect(copy).not.toBeNull();
    expect(copy?.disabled).toBe(true);

    copy?.click();
    expect(mounted.copies()).toEqual([]);
  });

  it("вызывает onCopy с открытой строкой", async () => {
    const target = row();
    const mounted = await mountDrawer(target);

    document.querySelector<HTMLButtonElement>(".audit-drawer__copy")?.click();

    expect(mounted.copies()).toEqual([target]);
  });

  it("закрывается по Escape, клику по backdrop и кнопке закрытия", async () => {
    const mounted = await mountDrawer(row());

    const escape = pressKey(document, "Escape");
    expect(escape.defaultPrevented).toBe(true);
    expect(mounted.closes()).toBe(1);

    document.querySelector<HTMLElement>(".audit-drawer-backdrop")?.click();
    expect(mounted.closes()).toBe(2);

    closeButton().click();
    expect(mounted.closes()).toBe(3);
  });

  it("фокусирует кнопку закрытия и замыкает Tab внутри панели", async () => {
    const mounted = await mountDrawer(row());

    await vi.waitFor(() => {
      expect(document.activeElement).toBe(closeButton());
    });

    const copy = document.querySelector<HTMLButtonElement>(".audit-drawer__copy");
    if (copy === null) throw new Error("copy button not found");
    copy.focus();

    const forward = pressKey(copy, "Tab");
    expect(forward.defaultPrevented).toBe(true);
    expect(document.activeElement).toBe(closeButton());

    const backward = pressKey(closeButton(), "Tab", true);
    expect(backward.defaultPrevented).toBe(true);
    expect(document.activeElement).toBe(copy);

    mounted.setRow(null);
    expect(drawer()).toBeNull();
  });

  it("блокирует прокрутку фона, пока панель открыта", async () => {
    document.body.style.overflow = "auto";
    const mounted = await mountDrawer(row());

    expect(document.body.style.overflow).toBe("hidden");

    mounted.setRow(null);

    expect(drawer()).toBeNull();
    expect(document.body.style.overflow).toBe("auto");
  });
});
