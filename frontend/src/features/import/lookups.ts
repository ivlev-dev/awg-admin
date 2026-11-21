import { computed, reactive } from "@ivlev-dev/silent-core";

import type { InterfacesService } from "@/application/interfaces/service";
import { userMessage } from "@/application/errors";
import type { NodesService } from "@/application/nodes/service";
import type { UsersService } from "@/application/users/service";
import { lookupInterfaces, lookupNodes, lookupUsers } from "@/app/lookups";
import type { ToastStore } from "@/app/toast";
import type { InterfaceInfo, NodeInfo, User } from "@/domain/types";
import { t } from "@/i18n";

export class ImportLookups {
  constructor(
    private readonly nodesService: NodesService,
    private readonly usersService: UsersService,
    private readonly interfacesService: InterfacesService,
    private readonly toasts: ToastStore,
  ) {}

  @reactive accessor nodes: NodeInfo[] = [];
  @reactive accessor nodesLoading = false;
  @reactive accessor nodesError: string | null = null;
  @reactive accessor owners: User[] = [];
  @reactive accessor ownersLoading = false;
  @reactive accessor ownersError: string | null = null;
  @reactive accessor interfaceList: InterfaceInfo[] = [];
  @reactive accessor interfacesLoading = false;
  @reactive accessor interfacesError: string | null = null;

  @computed
  get nodeOptions(): Array<{ value: string; label: string }> {
    return this.nodes.map((node) => ({
      value: node.id,
      label: `${node.name} · ${node.online ? "online" : "offline"}`,
    }));
  }

  @computed
  get ownerOptions(): Array<{ value: string; label: string }> {
    const options = [{ value: "", label: t("import.owner.none") }];
    for (const user of this.owners) {
      options.push({
        value: user.id,
        label: user.email,
      });
    }
    return options;
  }

  @computed
  get interfaceOptions(): Array<{ value: string; label: string }> {
    const options = [{ value: "", label: t("import.clients.interfaceAuto") }];
    for (const iface of this.interfaceList) {
      options.push({
        value: iface.id,
        label: `${iface.name} · ${iface.group_name} · ${iface.node_name}`,
      });
    }
    return options;
  }

  defaultNodeId(): string {
    return this.nodes.find((node) => node.online)?.id ?? this.nodes[0]?.id ?? "";
  }

  async loadNodes(): Promise<void> {
    this.nodesLoading = true;
    this.nodesError = null;
    try {
      this.nodes = await lookupNodes(this.nodesService);
    } catch (error) {
      this.nodesError = userMessage(error, t("import.error.nodesLoad"));
      this.toasts.error(this.nodesError);
    } finally {
      this.nodesLoading = false;
    }
  }

  async loadOwners(): Promise<void> {
    this.ownersLoading = true;
    this.ownersError = null;
    try {
      this.owners = await lookupUsers(this.usersService);
    } catch (error) {
      this.owners = [];
      this.ownersError = userMessage(error, t("import.error.usersLoad"));
      this.toasts.error(this.ownersError);
    } finally {
      this.ownersLoading = false;
    }
  }

  async loadInterfaces(): Promise<void> {
    this.interfacesLoading = true;
    this.interfacesError = null;
    try {
      this.interfaceList = await lookupInterfaces(this.interfacesService);
    } catch (error) {
      this.interfaceList = [];
      this.interfacesError = userMessage(error, t("import.clients.error.interfaces"));
      this.toasts.error(this.interfacesError);
    } finally {
      this.interfacesLoading = false;
    }
  }
}
