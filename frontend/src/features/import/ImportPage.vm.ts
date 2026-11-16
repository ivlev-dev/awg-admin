import { computed, reactive } from "@ivlev-dev/silent-core";

import { Router } from "@/app/router";
import { ToastStore } from "@/app/toast";
import { ImportService } from "@/application/import/service";
import { NodesService } from "@/application/nodes/service";
import type { ImportInput } from "@/domain/import/types";
import type { ImportResult, NodeInfo, PoolMode } from "@/domain/types";
import { cidrContains, isCidr } from "@/domain/validation";

interface PoolDraft {
  name: string;
  cidr: string;
  mode: PoolMode;
  gateway: string;
}

interface ClientDraft {
  name: string;
  config: string;
}

const DEFAULT_BASE_CIDR = "10.8.0.0/24";

function defaultPool(): PoolDraft {
  return { name: "default", cidr: DEFAULT_BASE_CIDR, mode: "auto", gateway: "" };
}

function readFileAsText(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(typeof reader.result === "string" ? reader.result : "");
    reader.onerror = () => reject(reader.error ?? new Error("Не удалось прочитать файл"));
    reader.readAsText(file);
  });
}

function fileBaseName(name: string): string {
  return name.replace(/\.[^.]+$/, "").trim();
}

function uniqueName(base: string, used: Set<string>): string {
  const trimmed = base.trim();
  const baseName = trimmed || "client";
  if (!used.has(baseName)) {
    used.add(baseName);
    return baseName;
  }
  let index = 2;
  while (used.has(`${baseName}-${index}`)) index += 1;
  const candidate = `${baseName}-${index}`;
  used.add(candidate);
  return candidate;
}

function extractPeerPublicKey(config: string): string | null {
  const match = /\[Peer\][\s\S]*?^\s*PublicKey\s*=\s*(\S+)/im.exec(config);
  return match?.[1]?.trim() ?? null;
}

function extractAddress(config: string): string {
  const match = /^\s*Address\s*=\s*(.+)$/im.exec(config);
  return match?.[1]?.trim() ?? "—";
}

export class ImportVM {
  @reactive accessor serverConfig = "";
  @reactive accessor groupName = "";
  @reactive accessor groupDescription = "";
  @reactive accessor baseCidr = DEFAULT_BASE_CIDR;
  @reactive accessor nodeId = "";
  @reactive accessor interfaceName = "awg0";
  @reactive accessor endpointHost = "";
  @reactive accessor endpointPort = 51820;
  @reactive accessor listenPort = 51820;
  @reactive accessor mtu = 1280;
  @reactive accessor pools: PoolDraft[] = [defaultPool()];
  @reactive accessor clientsText = "";
  @reactive accessor clients: ClientDraft[] = [];
  @reactive accessor nodes: NodeInfo[] = [];
  @reactive accessor nodesLoading = false;
  @reactive accessor nodesError: string | null = null;
  @reactive accessor importing = false;
  @reactive accessor error: string | null = null;
  @reactive accessor result: ImportResult | null = null;

  constructor(
    private readonly importService: ImportService,
    private readonly nodesService: NodesService,
    private readonly router: Router,
    private readonly toasts: ToastStore,
  ) {}

  async created(): Promise<void> {
    await this.loadNodes();
    if (!this.nodeId) {
      this.nodeId = this.nodes.find((node) => node.online)?.id ?? this.nodes[0]?.id ?? "";
    }
  }

  @computed
  get serverConfigValid(): boolean {
    const text = this.serverConfig;
    return /\[Interface\]/i.test(text) && /^\s*PrivateKey\s*=/im.test(text);
  }

  @computed
  get serverConfigWarning(): string | null {
    if (!this.serverConfig.trim() || this.serverConfigValid) return null;
    return "В конфиге не найден блок [Interface] с PrivateKey.";
  }

  @computed
  get baseCidrValid(): boolean {
    return isCidr(this.baseCidr);
  }

  @computed
  get interfaceValid(): boolean {
    return (
      this.interfaceName.trim().length > 0 &&
      this.endpointHost.trim().length > 0 &&
      this.isPort(this.endpointPort) &&
      this.isPort(this.listenPort) &&
      Number.isInteger(this.mtu) &&
      this.mtu >= 576 &&
      this.mtu <= 9000
    );
  }

  @computed
  get poolsValid(): boolean {
    return this.pools.length > 0 && this.pools.every((pool) => this.poolError(pool) === null);
  }

  @computed
  get paramsValid(): boolean {
    return (
      this.groupName.trim().length > 0 &&
      this.baseCidrValid &&
      this.nodeId.length > 0 &&
      this.interfaceValid &&
      this.poolsValid
    );
  }

  @computed
  get clientsValid(): boolean {
    return this.clients.every((client) => client.name.trim().length > 0 && client.config.trim().length > 0);
  }

  @computed
  get canImport(): boolean {
    return this.serverConfigValid && this.paramsValid && this.clientsValid && !this.importing;
  }

  @computed
  get resultFailed(): Array<{ name: string; error: string }> {
    return this.result?.failed_devices ?? [];
  }

  @computed
  get resultGroupPath(): string {
    return this.result ? `/groups/${this.result.group_id}` : "/groups";
  }

  @computed
  get distinctClientKeys(): string[] {
    const keys = new Set<string>();
    for (const client of this.clients) {
      const key = extractPeerPublicKey(client.config);
      if (key) keys.add(key);
    }
    return Array.from(keys);
  }

  @computed
  get clientKeysMismatch(): boolean {
    return this.distinctClientKeys.length > 1;
  }

  @computed
  get clientsWithoutKey(): number {
    return this.clients.filter((client) => extractPeerPublicKey(client.config) === null).length;
  }

  async loadNodes(): Promise<void> {
    this.nodesLoading = true;
    this.nodesError = null;
    try {
      this.nodes = await this.nodesService.listNodes();
    } catch (error) {
      this.nodesError = error instanceof Error ? error.message : "Не удалось загрузить ноды";
      this.toasts.error(this.nodesError);
    } finally {
      this.nodesLoading = false;
    }
  }

  setServerConfig(event: Event): void {
    this.serverConfig = (event.target as HTMLTextAreaElement).value;
  }

  async setServerFile(event: Event): Promise<void> {
    const input = event.target as HTMLInputElement;
    const file = input.files?.[0];
    if (!file) return;
    try {
      this.serverConfig = await readFileAsText(file);
      this.toasts.success(`Загружен серверный конфиг ${file.name}`);
    } catch (error) {
      this.toasts.error(error instanceof Error ? error.message : "Не удалось прочитать файл");
    } finally {
      input.value = "";
    }
  }

  setGroupName(event: Event): void {
    this.groupName = (event.target as HTMLInputElement).value;
  }

  setGroupDescription(event: Event): void {
    this.groupDescription = (event.target as HTMLInputElement).value;
  }

  setBaseCidr(event: Event): void {
    this.baseCidr = (event.target as HTMLInputElement).value;
  }

  setNode(value: string): void {
    this.nodeId = value;
  }

  setInterfaceName(event: Event): void {
    this.interfaceName = (event.target as HTMLInputElement).value;
  }

  setEndpointHost(event: Event): void {
    this.endpointHost = (event.target as HTMLInputElement).value;
  }

  setEndpointPort(event: Event): void {
    this.endpointPort = this.toNumber((event.target as HTMLInputElement).value);
  }

  setListenPort(event: Event): void {
    this.listenPort = this.toNumber((event.target as HTMLInputElement).value);
  }

  setMtu(event: Event): void {
    this.mtu = this.toNumber((event.target as HTMLInputElement).value);
  }

  addPool(): void {
    this.pools.push({
      name: `pool-${this.pools.length + 1}`,
      cidr: this.baseCidr,
      mode: "auto",
      gateway: "",
    });
  }

  removePool(index: number): void {
    this.pools.splice(index, 1);
  }

  setPoolName(index: number, event: Event): void {
    const pool = this.pools[index];
    if (pool) pool.name = (event.target as HTMLInputElement).value;
  }

  setPoolCidr(index: number, event: Event): void {
    const pool = this.pools[index];
    if (pool) pool.cidr = (event.target as HTMLInputElement).value;
  }

  setPoolMode(index: number, value: string): void {
    const pool = this.pools[index];
    if (pool && (value === "auto" || value === "rf_only" || value === "external_only")) {
      pool.mode = value;
    }
  }

  setPoolGateway(index: number, event: Event): void {
    const pool = this.pools[index];
    if (pool) pool.gateway = (event.target as HTMLInputElement).value;
  }

  poolError(pool: PoolDraft): string | null {
    if (!pool.name.trim()) return "Укажите имя пула";
    if (!pool.cidr.trim()) return "Укажите CIDR пула";
    if (!isCidr(pool.cidr)) return "Некорректный CIDR";
    if (this.baseCidrValid && !cidrContains(this.baseCidr, pool.cidr)) {
      return "Пул должен входить в base CIDR";
    }
    return null;
  }

  setClientsText(event: Event): void {
    this.clientsText = (event.target as HTMLTextAreaElement).value;
  }

  parseClients(notify = true): number {
    const text = this.clientsText.trim();
    if (!text) {
      this.toasts.error("Вставьте клиентские конфиги");
      return 0;
    }
    const parts = text
      .split(/^[ \t]*---[ \t]*\r?$/m)
      .map((part) => part.trim())
      .filter((part) => part.length > 0);
    if (parts.length === 0) {
      this.toasts.error("Не удалось найти клиентские конфиги");
      return 0;
    }
    const used = new Set<string>();
    this.clients = parts.map((config, index) => ({
      name: uniqueName(`client-${index + 1}`, used),
      config,
    }));
    if (notify) this.toasts.success(`Разобрано конфигов: ${parts.length}`);
    return parts.length;
  }

  async setClientFiles(event: Event): Promise<void> {
    const input = event.target as HTMLInputElement;
    const files = Array.from(input.files ?? []);
    if (files.length === 0) return;
    try {
      const loaded = await Promise.all(
        files.map(async (file) => ({
          name: fileBaseName(file.name),
          config: (await readFileAsText(file)).trim(),
        })),
      );
      const used = new Set(this.clients.map((client) => client.name));
      const additions = loaded
        .filter((item) => item.config.length > 0)
        .map((item, index) => ({
          name: uniqueName(item.name || `client-${this.clients.length + index + 1}`, used),
          config: item.config,
        }));
      this.clients = [...this.clients, ...additions];
      this.toasts.success(`Загружено конфигов: ${additions.length}`);
    } catch (error) {
      this.toasts.error(error instanceof Error ? error.message : "Не удалось прочитать файлы");
    } finally {
      input.value = "";
    }
  }

  setClientName(index: number, event: Event): void {
    const client = this.clients[index];
    if (client) client.name = (event.target as HTMLInputElement).value;
  }

  removeClient(index: number): void {
    this.clients.splice(index, 1);
  }

  clientAddress(config: string): string {
    return extractAddress(config);
  }

  clientPeerKey(config: string): string | null {
    return extractPeerPublicKey(config);
  }

  clientPreview(config: string): string {
    return config.split("\n").slice(0, 8).join("\n");
  }

  async importNow(): Promise<void> {
    if (this.importing) return;
    if (this.clients.length === 0 && this.clientsText.trim()) {
      const parsed = this.parseClients(false);
      if (parsed === 0) return;
    }
    if (!this.canImport) {
      this.toasts.error("Заполните обязательные поля");
      return;
    }

    const payload: ImportInput = {
      server_config: this.serverConfig,
      node_id: this.nodeId,
      group_name: this.groupName.trim(),
      group_description: this.groupDescription.trim(),
      base_cidr: this.baseCidr.trim(),
      pools: this.pools.map((pool) => ({
        name: pool.name.trim(),
        cidr: pool.cidr.trim(),
        mode: pool.mode,
        gateway: pool.gateway.trim() || null,
      })),
      interface: {
        name: this.interfaceName.trim(),
        endpoint_host: this.endpointHost.trim(),
        endpoint_port: this.endpointPort,
        listen_port: this.listenPort,
        mtu: this.mtu,
      },
      clients: this.clients.map((client, index) => ({
        name: client.name.trim() || `client-${index + 1}`,
        config: client.config,
      })),
      owner_user_id: null,
    };

    this.importing = true;
    this.error = null;
    this.result = null;
    try {
      const result = await this.importService.importConfig(payload);
      this.result = result;
      if (result.failed_devices.length > 0) {
        this.toasts.error(
          `Импортировано ${result.imported_devices}, ошибок ${result.failed_devices.length}`,
        );
      } else {
        this.toasts.success(`Импортировано устройств: ${result.imported_devices}`);
      }
    } catch (error) {
      this.error = error instanceof Error ? error.message : "Не удалось выполнить импорт";
      this.toasts.error(this.error);
    } finally {
      this.importing = false;
    }
  }

  openGroup(): void {
    this.router.navigate(this.resultGroupPath);
  }

  openNodes(): void {
    this.router.navigate("/nodes");
  }

  reset(): void {
    this.serverConfig = "";
    this.groupName = "";
    this.groupDescription = "";
    this.baseCidr = DEFAULT_BASE_CIDR;
    this.interfaceName = "awg0";
    this.endpointHost = "";
    this.endpointPort = 51820;
    this.listenPort = 51820;
    this.mtu = 1280;
    this.pools = [defaultPool()];
    this.clientsText = "";
    this.clients = [];
    this.error = null;
    this.result = null;
  }

  private isPort(value: number): boolean {
    return Number.isInteger(value) && value > 0 && value <= 65535;
  }

  private toNumber(value: string): number {
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : 0;
  }
}
