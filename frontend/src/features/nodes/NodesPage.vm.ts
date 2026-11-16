import { computed, reactive } from "@ivlev-dev/silent-core";

import { api, session, toasts } from "@/app/container";
import type { NodeCreated } from "@/application/api";
import { plural, relativeTime } from "@/domain/format";
import type { NodeInfo } from "@/domain/types";

export class NodesPageVM {
  @reactive accessor nodes: NodeInfo[] = [];
  @reactive accessor loading = true;
  @reactive accessor busy = false;
  @reactive accessor error: string | null = null;

  @reactive accessor createOpen = false;
  @reactive accessor name = "";
  @reactive accessor formError: string | null = null;

  @reactive accessor createdNode: NodeCreated | null = null;
  @reactive accessor tokenCopied = false;

  created(): void {
    void this.load();
  }

  get isAdmin(): boolean {
    return session.isAdmin;
  }

  @computed
  get online(): number {
    return this.nodes.filter((node) => node.online).length;
  }

  @computed
  get canCreate(): boolean {
    return this.name.trim().length > 0 && !this.busy;
  }

  async load(): Promise<void> {
    this.loading = true;
    this.error = null;
    try {
      const nodes = await api.listNodes();
      this.nodes = [...nodes].sort(
        (left, right) => Number(right.online) - Number(left.online) || left.name.localeCompare(right.name),
      );
    } catch (error) {
      this.error = messageOf(error, "Не удалось загрузить ноды");
    } finally {
      this.loading = false;
    }
  }

  openCreate(): void {
    this.createOpen = true;
    this.name = "";
    this.formError = null;
    this.tokenCopied = false;
  }

  closeCreate(): void {
    if (this.busy) return;
    this.createOpen = false;
    this.formError = null;
  }

  closeCreated(): void {
    this.createdNode = null;
    this.tokenCopied = false;
  }

  setName(event: Event): void {
    this.name = (event.target as HTMLInputElement).value;
  }

  async submitCreate(event: Event): Promise<void> {
    event.preventDefault();
    if (!this.canCreate) return;
    this.busy = true;
    this.formError = null;
    try {
      const result = await api.createNode(this.name.trim());
      this.createdNode = result;
      this.createOpen = false;
      this.name = "";
      toasts.success(`Нода «${result.node.name}» создана`);
      await this.load();
    } catch (error) {
      const message = messageOf(error, "Не удалось создать ноду");
      this.formError = message;
      toasts.error(message);
    } finally {
      this.busy = false;
    }
  }

  async copyToken(): Promise<void> {
    const token = this.createdNode?.token;
    if (!token) return;
    const copied = await copyText(token);
    this.tokenCopied = copied;
    if (copied) {
      toasts.success("Токен скопирован");
    } else {
      toasts.error("Не удалось скопировать токен");
    }
  }

  async remove(node: NodeInfo): Promise<void> {
    if (this.busy) return;
    const confirmed = window.confirm(
      `Удалить ноду «${node.name}»?\n\nСначала отвяжите от неё интерфейсы: без ноды они останутся без воркера.`,
    );
    if (!confirmed) return;
    this.busy = true;
    try {
      await api.deleteNode(node.id);
      toasts.success(`Нода «${node.name}» удалена`);
      await this.load();
    } catch (error) {
      toasts.error(messageOf(error, "Не удалось удалить ноду"));
    } finally {
      this.busy = false;
    }
  }

  lastSeen(value: string | null): string {
    return relativeTime(value);
  }

  interfacesLabel(node: NodeInfo): string {
    return `${node.interfaces} ${plural(node.interfaces, "интерфейс", "интерфейса", "интерфейсов")}`;
  }
}

function messageOf(error: unknown, fallback: string): string {
  return error instanceof Error && error.message ? error.message : fallback;
}

async function copyText(value: string): Promise<boolean> {
  try {
    if (navigator.clipboard && typeof navigator.clipboard.writeText === "function") {
      await navigator.clipboard.writeText(value);
      return true;
    }
    const area = document.createElement("textarea");
    area.value = value;
    area.setAttribute("readonly", "");
    area.style.position = "fixed";
    area.style.top = "-1000px";
    document.body.appendChild(area);
    area.select();
    const copied = document.execCommand("copy");
    document.body.removeChild(area);
    return copied;
  } catch {
    return false;
  }
}
