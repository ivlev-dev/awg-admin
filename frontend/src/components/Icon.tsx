import { ArrowDownIcon } from "./icons/ArrowDownIcon";
import { ArrowUpIcon } from "./icons/ArrowUpIcon";
import { CheckIcon } from "./icons/CheckIcon";
import { ChevronIcon } from "./icons/ChevronIcon";
import { ClientsIcon } from "./icons/ClientsIcon";
import { ClockIcon } from "./icons/ClockIcon";
import { CloseIcon } from "./icons/CloseIcon";
import { CopyIcon } from "./icons/CopyIcon";
import { DownloadIcon } from "./icons/DownloadIcon";
import { EditIcon } from "./icons/EditIcon";
import { GlobeIcon } from "./icons/GlobeIcon";
import { GroupsIcon } from "./icons/GroupsIcon";
import { ImportIcon } from "./icons/ImportIcon";
import { InterfacesIcon } from "./icons/InterfacesIcon";
import { LinkIcon } from "./icons/LinkIcon";
import { LogoutIcon } from "./icons/LogoutIcon";
import { MenuIcon } from "./icons/MenuIcon";
import { MoonIcon } from "./icons/MoonIcon";
import { NodesIcon } from "./icons/NodesIcon";
import { OverviewIcon } from "./icons/OverviewIcon";
import { PlusIcon } from "./icons/PlusIcon";
import { ProfileIcon } from "./icons/ProfileIcon";
import { RefreshIcon } from "./icons/RefreshIcon";
import { SearchIcon } from "./icons/SearchIcon";
import { ServerIcon } from "./icons/ServerIcon";
import { SettingsIcon } from "./icons/SettingsIcon";
import { ShieldIcon } from "./icons/ShieldIcon";
import { StatsIcon } from "./icons/StatsIcon";
import { SunIcon } from "./icons/SunIcon";
import { TariffsIcon } from "./icons/TariffsIcon";
import { TrafficIcon } from "./icons/TrafficIcon";
import { TrashIcon } from "./icons/TrashIcon";
import { UsersIcon } from "./icons/UsersIcon";
import { WarningIcon } from "./icons/WarningIcon";
import type { IconProps } from "./icons/types";

export const ICON_NAMES = [
  "overview",
  "nodes",
  "interfaces",
  "groups",
  "clients",
  "import",
  "tariffs",
  "users",
  "stats",
  "settings",
  "profile",
  "logout",
  "menu",
  "close",
  "plus",
  "search",
  "refresh",
  "trash",
  "edit",
  "copy",
  "download",
  "link",
  "clock",
  "sun",
  "moon",
  "arrowUp",
  "arrowDown",
  "shield",
  "globe",
  "chevron",
  "check",
  "warning",
  "server",
  "traffic",
] as const;

export type IconName = (typeof ICON_NAMES)[number];

export type { IconProps };

export const ICON_COMPONENTS = {
  overview: OverviewIcon,
  nodes: NodesIcon,
  interfaces: InterfacesIcon,
  groups: GroupsIcon,
  clients: ClientsIcon,
  import: ImportIcon,
  tariffs: TariffsIcon,
  users: UsersIcon,
  stats: StatsIcon,
  settings: SettingsIcon,
  profile: ProfileIcon,
  logout: LogoutIcon,
  menu: MenuIcon,
  close: CloseIcon,
  plus: PlusIcon,
  search: SearchIcon,
  refresh: RefreshIcon,
  trash: TrashIcon,
  edit: EditIcon,
  copy: CopyIcon,
  download: DownloadIcon,
  link: LinkIcon,
  clock: ClockIcon,
  sun: SunIcon,
  moon: MoonIcon,
  arrowUp: ArrowUpIcon,
  arrowDown: ArrowDownIcon,
  shield: ShieldIcon,
  globe: GlobeIcon,
  chevron: ChevronIcon,
  check: CheckIcon,
  warning: WarningIcon,
  server: ServerIcon,
  traffic: TrafficIcon,
} satisfies Record<IconName, (props: IconProps) => Node>;

export function Icon(props: { name: IconName; size?: number; class?: string }): Node {
  const Component = ICON_COMPONENTS[props.name];
  return Component({
    size: props.size ?? 20,
    class: props.class ?? "nav-item__icon",
  });
}
