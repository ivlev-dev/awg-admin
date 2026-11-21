use std::collections::{BTreeMap, HashMap};
use std::sync::Mutex;

use anyhow::{Context, Result, anyhow, bail};
use async_trait::async_trait;
use tokio::process::Command;
use uuid::Uuid;

use crate::application::TrafficShaper;
use crate::domain::{DesiredInterface, DesiredPeer};

/// Explicit link ceiling used for "unlimited" (`0`) rates and for the root
/// class when at least one user has no limit. Without it the root class would
/// be capped by the sum of the *limited* users only, throttling everyone else.
pub const LINK_CAPACITY_KBPS: u32 = 10_000_000;

/// Class layout: users start at `1:100`, device classes at `1:1000` with a
/// stride of 1000 per user. This keeps `1:1000 + user * 1000 + peer` unique
/// for up to 64 users with 1000 peers each (and well beyond the 100-peer case
/// that collided with the old `user * 100` scheme).
const USER_CLASS_BASE: u32 = 100;
const DEVICE_CLASS_BASE: u32 = 1_000;
const CLASS_STRIDE: u32 = 1_000;
const MAX_CLASSID: u32 = u16::MAX as u32;
const MIRRED_HANDLE: u32 = 1;

pub struct TcShaper {
    dry_run: bool,
    plans: Mutex<HashMap<String, InterfacePlans>>,
}

#[derive(Debug, Clone, Default)]
struct InterfacePlans {
    down: Option<DirectionPlan>,
    up: Option<DirectionPlan>,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
enum Direction {
    Down,
    Up,
}

impl Direction {
    fn match_kind(self) -> &'static str {
        match self {
            Self::Down => "dst",
            Self::Up => "src",
        }
    }
}

#[derive(Debug, Clone, PartialEq, Eq)]
struct ClassSpec {
    classid: u32,
    parent: u32,
    rate_kbps: u32,
}

#[derive(Debug, Clone, PartialEq, Eq)]
struct FilterSpec {
    handle: u32,
    ip: String,
    flowid: u32,
}

#[derive(Debug, Clone, PartialEq, Eq)]
struct DirectionPlan {
    root_rate_kbps: u32,
    users: Vec<ClassSpec>,
    devices: Vec<ClassSpec>,
    filters: Vec<FilterSpec>,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
enum PlanAction {
    Unchanged,
    Full,
    Diff,
}

#[derive(Debug, Clone, PartialEq, Eq)]
struct ShellCommand {
    program: &'static str,
    args: Vec<String>,
    optional: bool,
}

impl ShellCommand {
    fn tc(args: &[&str]) -> Self {
        Self {
            program: "tc",
            args: strings(args),
            optional: false,
        }
    }

    fn tc_optional(args: &[&str]) -> Self {
        Self {
            optional: true,
            ..Self::tc(args)
        }
    }

    fn ip(args: &[&str]) -> Self {
        Self {
            program: "ip",
            args: strings(args),
            optional: false,
        }
    }

    fn ip_optional(args: &[&str]) -> Self {
        Self {
            optional: true,
            ..Self::ip(args)
        }
    }
}

impl TcShaper {
    pub fn new(dry_run: bool) -> Self {
        Self {
            dry_run,
            plans: Mutex::new(HashMap::new()),
        }
    }

    /// Canonical user list: sorted and deduplicated. Every class index in the
    /// plan, in `apply` and in `root_rate` is derived from this single list,
    /// so the qdisc, classes and filters can never disagree about `1:100+i`.
    fn canonical_users(interface: &DesiredInterface) -> Vec<(Uuid, u32)> {
        let mut users: Vec<Uuid> = interface
            .user_limits
            .iter()
            .map(|limit| limit.user_id)
            .chain(interface.peers.iter().map(|peer| peer.user_id))
            .collect();
        users.sort();
        users.dedup();
        users
            .into_iter()
            .enumerate()
            .map(|(index, user_id)| (user_id, USER_CLASS_BASE + index as u32))
            .collect()
    }

    fn group_limit(interface: &DesiredInterface, user_id: Uuid, direction: Direction) -> u32 {
        interface
            .user_limits
            .iter()
            .find(|limit| limit.user_id == user_id)
            .map(|limit| match direction {
                Direction::Down => limit.group_down_kbps,
                Direction::Up => limit.group_up_kbps,
            })
            .unwrap_or(0)
    }

    fn peer_limit(peer: &DesiredPeer, direction: Direction) -> u32 {
        match direction {
            Direction::Down => peer.down_kbps,
            Direction::Up => peer.up_kbps,
        }
    }

    /// Explicit root ceiling. `0` means "no limit" for a user, so the root
    /// class must be configured with the physical link capacity instead of
    /// the (too small) sum of the remaining limits.
    fn root_rate(interface: &DesiredInterface, direction: Direction) -> u32 {
        let users = Self::canonical_users(interface);
        if users.is_empty() {
            return LINK_CAPACITY_KBPS;
        }
        let mut sum: u64 = 0;
        for (user_id, _) in &users {
            let limit = Self::group_limit(interface, *user_id, direction);
            if limit == 0 {
                return LINK_CAPACITY_KBPS;
            }
            sum = sum.saturating_add(u64::from(limit));
        }
        u32::try_from(sum.min(u64::from(LINK_CAPACITY_KBPS))).unwrap_or(LINK_CAPACITY_KBPS)
    }

    /// `0` means unlimited, so it maps to the explicit link ceiling (10 Gbit)
    /// which `tc` accepts as a finite rate.
    fn rate_kbps(value: u32) -> u32 {
        if value == 0 {
            LINK_CAPACITY_KBPS
        } else {
            value
        }
    }

    fn rate(value: u32) -> String {
        format!("{}kbit", Self::rate_kbps(value))
    }

    fn per_user_peer_index(
        interface: &DesiredInterface,
    ) -> Result<HashMap<(Uuid, Uuid, Uuid), usize>> {
        let mut peers: Vec<&DesiredPeer> = interface.peers.iter().collect();
        peers.sort_by_key(|peer| (peer.user_id, peer.device_id, peer.peer_id));
        let mut counters: HashMap<Uuid, usize> = HashMap::new();
        let mut indexes = HashMap::new();
        for peer in peers {
            let key = (peer.user_id, peer.device_id, peer.peer_id);
            if indexes.contains_key(&key) {
                bail!(
                    "interface {} has duplicate peer identity {} (user {})",
                    interface.name,
                    peer.device_id,
                    peer.user_id
                );
            }
            let index = counters.entry(peer.user_id).or_insert(0);
            indexes.insert(key, *index);
            *index += 1;
        }
        Ok(indexes)
    }

    fn peer_ip(peer: &DesiredPeer, interface: &str) -> Result<Option<String>> {
        let Some(address) = peer.addresses.first() else {
            return Ok(None);
        };
        let address = address.split('/').next().unwrap_or(address);
        let ip: std::net::Ipv4Addr = address.parse().with_context(|| {
            format!(
                "interface {interface} peer {} has unsupported address {address:?}: tc u32 filters require IPv4",
                peer.device_id
            )
        })?;
        Ok(Some(ip.to_string()))
    }

    fn plan(interface: &DesiredInterface, direction: Direction) -> Result<DirectionPlan> {
        let users = Self::canonical_users(interface);
        if let Some((_, classid)) = users.last()
            && *classid >= DEVICE_CLASS_BASE
        {
            bail!(
                "interface {} has too many users ({}) for the tc class layout",
                interface.name,
                DEVICE_CLASS_BASE - USER_CLASS_BASE
            );
        }
        let root_rate_kbps = Self::root_rate(interface, direction);
        let user_classes = users
            .iter()
            .map(|(user_id, classid)| ClassSpec {
                classid: *classid,
                parent: 1,
                rate_kbps: Self::group_limit(interface, *user_id, direction),
            })
            .collect();

        let indexes = Self::per_user_peer_index(interface)?;
        let mut devices = Vec::new();
        let mut filters: BTreeMap<String, u32> = BTreeMap::new();
        for peer in &interface.peers {
            let limit = Self::peer_limit(peer, direction);
            let group = Self::group_limit(interface, peer.user_id, direction);
            if limit == 0 && group == 0 {
                continue;
            }
            let Some(ip) = Self::peer_ip(peer, &interface.name)? else {
                continue;
            };
            let Some((_, user_class)) = users.iter().find(|(user_id, _)| *user_id == peer.user_id)
            else {
                bail!(
                    "interface {} peer {} has no user class",
                    interface.name,
                    peer.device_id
                );
            };
            let flowid = if limit == 0 {
                *user_class
            } else {
                let index = indexes
                    .get(&(peer.user_id, peer.device_id, peer.peer_id))
                    .copied()
                    .ok_or_else(|| anyhow!("missing index for peer {}", peer.device_id))?;
                let classid = DEVICE_CLASS_BASE
                    + (*user_class - USER_CLASS_BASE) * CLASS_STRIDE
                    + index as u32;
                if classid > MAX_CLASSID {
                    bail!(
                        "interface {} has too many peers for user {}: classid {classid} exceeds {MAX_CLASSID}",
                        interface.name,
                        peer.user_id
                    );
                }
                devices.push(ClassSpec {
                    classid,
                    parent: *user_class,
                    rate_kbps: limit,
                });
                classid
            };
            if let Some(existing) = filters.get(&ip)
                && *existing != flowid
            {
                bail!(
                    "interface {} has conflicting limits for peer address {ip}",
                    interface.name
                );
            }
            filters.insert(ip, flowid);
        }

        devices.sort_by_key(|spec| spec.classid);
        let filters = filters
            .into_iter()
            .enumerate()
            .map(|(index, (ip, flowid))| FilterSpec {
                handle: index as u32 + 1,
                ip,
                flowid,
            })
            .collect();

        Ok(DirectionPlan {
            root_rate_kbps,
            users: user_classes,
            devices,
            filters,
        })
    }

    fn plan_action(previous: Option<&DirectionPlan>, next: &DirectionPlan) -> PlanAction {
        match previous {
            Some(previous) if previous == next => PlanAction::Unchanged,
            Some(_) => PlanAction::Diff,
            None => PlanAction::Full,
        }
    }

    fn cached(&self, name: &str, direction: Direction) -> Option<DirectionPlan> {
        let plans = self.plans.lock().expect("tc plan lock");
        let plans = plans.get(name)?;
        match direction {
            Direction::Down => plans.down.clone(),
            Direction::Up => plans.up.clone(),
        }
    }

    fn store(&self, name: &str, direction: Direction, plan: DirectionPlan) {
        let mut plans = self.plans.lock().expect("tc plan lock");
        let entry = plans.entry(name.to_string()).or_default();
        match direction {
            Direction::Down => entry.down = Some(plan),
            Direction::Up => entry.up = Some(plan),
        }
    }

    fn forget(&self, name: &str) {
        self.plans.lock().expect("tc plan lock").remove(name);
    }

    async fn execute(&self, command: &ShellCommand) -> Result<()> {
        if self.dry_run {
            tracing::info!("dry-run: {} {}", command.program, command.args.join(" "));
            return Ok(());
        }
        let output = Command::new(command.program)
            .args(&command.args)
            .output()
            .await
            .with_context(|| format!("failed to spawn {}", command.program))?;
        if !output.status.success() {
            let stderr = String::from_utf8_lossy(&output.stderr).trim().to_string();
            if command.optional {
                tracing::debug!(
                    "{} {} ignored: {stderr}",
                    command.program,
                    command.args.join(" ")
                );
                return Ok(());
            }
            return Err(anyhow!(
                "{} {} failed: {stderr}",
                command.program,
                command.args.join(" ")
            ));
        }
        Ok(())
    }

    async fn execute_all(&self, commands: &[ShellCommand]) -> Result<()> {
        for command in commands {
            self.execute(command).await?;
        }
        Ok(())
    }

    async fn run_ip(&self, args: &[&str]) -> Result<()> {
        self.execute(&ShellCommand::ip(args)).await
    }

    async fn ensure_ifb(&self, ifb: &str) -> Result<()> {
        if self.dry_run {
            self.run_ip(&["link", "add", ifb, "type", "ifb"]).await?;
            return self.run_ip(&["link", "set", "dev", ifb, "up"]).await;
        }
        let _ = Command::new("modprobe").arg("ifb").output().await;
        let exists = Command::new("ip")
            .args(["link", "show", ifb])
            .output()
            .await
            .map(|output| output.status.success())
            .unwrap_or(false);
        if !exists {
            self.run_ip(&["link", "add", ifb, "type", "ifb"]).await?;
        }
        self.run_ip(&["link", "set", "dev", ifb, "up"]).await
    }

    async fn apply_direction(
        &self,
        interface: &DesiredInterface,
        direction: Direction,
    ) -> Result<()> {
        let plan = Self::plan(interface, direction)?;
        let previous = self.cached(&interface.name, direction);

        if plan.filters.is_empty() {
            if previous.as_ref() == Some(&plan) {
                tracing::debug!(
                    interface = %interface.name,
                    "tc plan is unchanged, skipping"
                );
                return Ok(());
            }
            self.clear_direction(&interface.name, direction).await?;
            self.store(&interface.name, direction, plan);
            return Ok(());
        }

        match Self::plan_action(previous.as_ref(), &plan) {
            PlanAction::Unchanged => {
                tracing::debug!(
                    interface = %interface.name,
                    "tc plan is unchanged, skipping"
                );
                return Ok(());
            }
            PlanAction::Full => {
                let commands = self.full_commands(interface, &plan, direction).await?;
                self.execute_all(&commands).await?;
            }
            PlanAction::Diff => {
                let previous = previous.expect("diff requires a previous plan");
                let commands = diff_commands(
                    &interface.name,
                    &ifb_name(&interface.name),
                    &previous,
                    &plan,
                    direction,
                );
                if let Err(error) = self.execute_all(&commands).await {
                    tracing::warn!(
                        interface = %interface.name,
                        %error,
                        "incremental tc update failed, rebuilding the qdisc"
                    );
                    let commands = self.full_commands(interface, &plan, direction).await?;
                    self.execute_all(&commands).await?;
                }
            }
        }

        self.store(&interface.name, direction, plan);
        Ok(())
    }

    async fn full_commands(
        &self,
        interface: &DesiredInterface,
        plan: &DirectionPlan,
        direction: Direction,
    ) -> Result<Vec<ShellCommand>> {
        let dev = &interface.name;
        match direction {
            Direction::Down => Ok(egress_full_commands(dev, plan)),
            Direction::Up => {
                let ifb = ifb_name(dev);
                self.ensure_ifb(&ifb).await?;
                Ok(ingress_full_commands(dev, &ifb, plan))
            }
        }
    }

    async fn clear_direction(&self, name: &str, direction: Direction) -> Result<()> {
        match direction {
            Direction::Down => {
                self.execute(&ShellCommand::tc_optional(&[
                    "qdisc", "del", "dev", name, "root",
                ]))
                .await
            }
            Direction::Up => self.clear_ingress(name).await,
        }
    }

    async fn clear_ingress(&self, dev: &str) -> Result<()> {
        for command in ingress_cleanup_commands(dev) {
            self.execute(&command).await?;
        }
        Ok(())
    }
}

#[async_trait]
impl TrafficShaper for TcShaper {
    async fn apply(&self, interface: &DesiredInterface) -> Result<()> {
        if !shaping_needed(interface) {
            self.clear(&interface.name).await?;
            return Ok(());
        }
        self.apply_direction(interface, Direction::Down).await?;
        self.apply_direction(interface, Direction::Up).await
    }

    async fn clear(&self, name: &str) -> Result<()> {
        self.clear_direction(name, Direction::Down).await?;
        self.clear_ingress(name).await?;
        self.forget(name);
        Ok(())
    }
}

fn shaping_needed(interface: &DesiredInterface) -> bool {
    interface
        .user_limits
        .iter()
        .any(|limit| limit.group_down_kbps > 0 || limit.group_up_kbps > 0)
        || interface
            .peers
            .iter()
            .any(|peer| peer.down_kbps > 0 || peer.up_kbps > 0)
}

fn class_command(action: &str, dev: &str, spec: &ClassSpec) -> ShellCommand {
    ShellCommand::tc(&[
        "class",
        action,
        "dev",
        dev,
        "parent",
        &format!("1:{}", spec.parent),
        "classid",
        &format!("1:{}", spec.classid),
        "htb",
        "rate",
        &TcShaper::rate(spec.rate_kbps),
        "ceil",
        &TcShaper::rate(spec.rate_kbps),
    ])
}

fn class_delete(dev: &str, spec: &ClassSpec) -> ShellCommand {
    ShellCommand::tc(&[
        "class",
        "del",
        "dev",
        dev,
        "parent",
        &format!("1:{}", spec.parent),
        "classid",
        &format!("1:{}", spec.classid),
    ])
}

fn root_class_command(action: &str, dev: &str, rate_kbps: u32) -> ShellCommand {
    ShellCommand::tc(&[
        "class",
        action,
        "dev",
        dev,
        "parent",
        "1:",
        "classid",
        "1:1",
        "htb",
        "rate",
        &TcShaper::rate(rate_kbps),
        "ceil",
        &TcShaper::rate(rate_kbps),
    ])
}

fn filter_command(
    action: &str,
    dev: &str,
    spec: &FilterSpec,
    direction: Direction,
) -> ShellCommand {
    ShellCommand::tc(&[
        "filter",
        action,
        "dev",
        dev,
        "protocol",
        "ip",
        "parent",
        "1:",
        "prio",
        "1",
        "handle",
        &format!("0x{:x}", spec.handle),
        "u32",
        "match",
        "ip",
        direction.match_kind(),
        &format!("{}/32", spec.ip),
        "flowid",
        &format!("1:{}", spec.flowid),
    ])
}

fn filter_delete(dev: &str, spec: &FilterSpec) -> ShellCommand {
    ShellCommand::tc(&[
        "filter",
        "del",
        "dev",
        dev,
        "protocol",
        "ip",
        "parent",
        "1:",
        "prio",
        "1",
        "handle",
        &format!("0x{:x}", spec.handle),
        "u32",
    ])
}

fn mirred_command(dev: &str, ifb: &str) -> ShellCommand {
    ShellCommand::tc(&[
        "filter",
        "replace",
        "dev",
        dev,
        "protocol",
        "ip",
        "parent",
        "ffff:",
        "prio",
        "1",
        "handle",
        &format!("0x{MIRRED_HANDLE:x}"),
        "u32",
        "match",
        "u32",
        "0",
        "0",
        "action",
        "mirred",
        "egress",
        "redirect",
        "dev",
        ifb,
    ])
}

fn htb_full_commands(dev: &str, plan: &DirectionPlan, direction: Direction) -> Vec<ShellCommand> {
    let mut commands = vec![root_class_command("add", dev, plan.root_rate_kbps)];
    commands.extend(
        plan.users
            .iter()
            .map(|spec| class_command("add", dev, spec)),
    );
    commands.extend(
        plan.devices
            .iter()
            .map(|spec| class_command("add", dev, spec)),
    );
    commands.extend(
        plan.filters
            .iter()
            .map(|spec| filter_command("replace", dev, spec, direction)),
    );
    commands
}

/// Applies only the delta: root rate change, added/changed/removed classes and
/// filter replacements/deletions. The root qdisc is never recreated here.
fn htb_diff_commands(
    dev: &str,
    previous: &DirectionPlan,
    next: &DirectionPlan,
    direction: Direction,
) -> Vec<ShellCommand> {
    let mut commands = Vec::new();

    for filter in &previous.filters {
        if !next
            .filters
            .iter()
            .any(|candidate| candidate.handle == filter.handle)
        {
            commands.push(filter_delete(dev, filter));
        }
    }

    for spec in &previous.devices {
        if !next
            .devices
            .iter()
            .any(|candidate| candidate.classid == spec.classid)
        {
            commands.push(class_delete(dev, spec));
        }
    }
    for spec in &previous.users {
        if !next
            .users
            .iter()
            .any(|candidate| candidate.classid == spec.classid)
        {
            commands.push(class_delete(dev, spec));
        }
    }

    if previous.root_rate_kbps != next.root_rate_kbps {
        commands.push(root_class_command("change", dev, next.root_rate_kbps));
    }

    for spec in &next.users {
        match previous
            .users
            .iter()
            .find(|old| old.classid == spec.classid)
        {
            Some(old) if old.rate_kbps == spec.rate_kbps => {}
            Some(_) => commands.push(class_command("change", dev, spec)),
            None => commands.push(class_command("add", dev, spec)),
        }
    }
    for spec in &next.devices {
        match previous
            .devices
            .iter()
            .find(|old| old.classid == spec.classid)
        {
            Some(old) if old.rate_kbps == spec.rate_kbps => {}
            Some(_) => commands.push(class_command("change", dev, spec)),
            None => commands.push(class_command("add", dev, spec)),
        }
    }

    for filter in &next.filters {
        let unchanged = previous.filters.iter().any(|old| {
            old.handle == filter.handle && old.ip == filter.ip && old.flowid == filter.flowid
        });
        if !unchanged {
            commands.push(filter_command("replace", dev, filter, direction));
        }
    }

    commands
}

fn egress_full_commands(dev: &str, plan: &DirectionPlan) -> Vec<ShellCommand> {
    let mut commands = vec![
        ShellCommand::tc_optional(&["qdisc", "del", "dev", dev, "root"]),
        ShellCommand::tc(&[
            "qdisc", "add", "dev", dev, "root", "handle", "1:", "htb", "default", "1",
        ]),
    ];
    commands.extend(htb_full_commands(dev, plan, Direction::Down));
    commands
}

fn egress_diff_commands(
    dev: &str,
    previous: &DirectionPlan,
    next: &DirectionPlan,
) -> Vec<ShellCommand> {
    htb_diff_commands(dev, previous, next, Direction::Down)
}

fn ingress_full_commands(dev: &str, ifb: &str, plan: &DirectionPlan) -> Vec<ShellCommand> {
    let mut commands = vec![
        ShellCommand::tc_optional(&["qdisc", "del", "dev", dev, "ingress"]),
        ShellCommand::tc(&["qdisc", "add", "dev", dev, "handle", "ffff:", "ingress"]),
        mirred_command(dev, ifb),
        ShellCommand::tc_optional(&["qdisc", "del", "dev", ifb, "root"]),
        ShellCommand::tc(&[
            "qdisc", "add", "dev", ifb, "root", "handle", "1:", "htb", "default", "1",
        ]),
    ];
    commands.extend(htb_full_commands(ifb, plan, Direction::Up));
    commands
}

fn diff_commands(
    dev: &str,
    ifb: &str,
    previous: &DirectionPlan,
    next: &DirectionPlan,
    direction: Direction,
) -> Vec<ShellCommand> {
    match direction {
        Direction::Down => egress_diff_commands(dev, previous, next),
        Direction::Up => {
            let mut commands = vec![mirred_command(dev, ifb)];
            commands.extend(htb_diff_commands(ifb, previous, next, Direction::Up));
            commands
        }
    }
}

pub fn ifb_name(name: &str) -> String {
    let hash = fnv1a64(name.as_bytes()) & ((1 << 44) - 1);
    format!("ifb-{hash:011x}")
}

pub(crate) fn fnv1a64(bytes: &[u8]) -> u64 {
    let mut hash: u64 = 0xcbf2_9ce4_8422_2325;
    for byte in bytes {
        hash ^= u64::from(*byte);
        hash = hash.wrapping_mul(0x0000_0100_0000_01b3);
    }
    hash
}

fn strings(parts: &[&str]) -> Vec<String> {
    parts.iter().map(|part| (*part).to_string()).collect()
}

fn ingress_cleanup_commands(dev: &str) -> Vec<ShellCommand> {
    let ifb = ifb_name(dev);
    vec![
        ShellCommand::tc_optional(&["filter", "del", "dev", dev, "parent", "ffff:"]),
        ShellCommand::tc_optional(&["qdisc", "del", "dev", dev, "ingress"]),
        ShellCommand::tc_optional(&["qdisc", "del", "dev", &ifb, "root"]),
        ShellCommand::ip_optional(&["link", "del", &ifb]),
    ]
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::domain::{DesiredPeer, UserLimit, WireObf};
    use std::collections::HashSet;
    use uuid::Uuid;

    #[test]
    fn root_qdisc_is_recreated_without_replace() {
        let commands = egress_full_commands("awg0", &plan_for(&interface(vec![], vec![])));
        assert_eq!(
            commands[0].args,
            strings(&["qdisc", "del", "dev", "awg0", "root"])
        );
        assert_eq!(
            commands[1].args,
            strings(&[
                "qdisc", "add", "dev", "awg0", "root", "handle", "1:", "htb", "default", "1",
            ])
        );
        assert!(
            commands
                .iter()
                .flat_map(|command| command.args.iter())
                .all(|arg| arg != "replace" && arg != "change"),
            "htb root does not support change/replace, so both must be avoided"
        );
    }

    #[test]
    fn ingress_qdisc_is_recreated_without_replace() {
        let plan = plan_for(&interface(vec![], vec![]));
        let commands = ingress_full_commands("awg0", "ifb-awg0", &plan);
        assert_eq!(
            commands[0].args,
            strings(&["qdisc", "del", "dev", "awg0", "ingress"])
        );
        assert_eq!(
            commands[1].args,
            strings(&["qdisc", "add", "dev", "awg0", "handle", "ffff:", "ingress"])
        );
        assert_eq!(commands[2], mirred_command("awg0", "ifb-awg0"));
    }

    #[test]
    fn ingress_cleanup_removes_filter_qdisc_and_ifb() {
        let ifb = ifb_name("awg0");
        let commands = ingress_cleanup_commands("awg0");
        assert_eq!(
            commands[0].args,
            strings(&["filter", "del", "dev", "awg0", "parent", "ffff:"])
        );
        assert_eq!(
            commands[1].args,
            strings(&["qdisc", "del", "dev", "awg0", "ingress"])
        );
        assert_eq!(
            commands[2].args,
            strings(&["qdisc", "del", "dev", &ifb, "root"])
        );
        assert_eq!(commands[3].args, strings(&["link", "del", &ifb]));
    }

    fn interface(user_limits: Vec<UserLimit>, peers: Vec<DesiredPeer>) -> DesiredInterface {
        DesiredInterface {
            id: Uuid::nil(),
            name: "awg0".to_string(),
            listen_port: 51820,
            mtu: 1420,
            private_key: String::new(),
            public_key: String::new(),
            enabled: true,
            obf: WireObf {
                h1: String::new(),
                h2: String::new(),
                h3: String::new(),
                h4: String::new(),
                s1: 0,
                s2: 0,
                s3: 0,
                s4: 0,
                header_protection_key: String::new(),
                random_trailers: false,
            },
            addresses: vec![],
            peers,
            group_down_kbps: 0,
            group_up_kbps: 0,
            user_limits,
            forwarding: vec![],
        }
    }

    fn peer(down_kbps: u32, up_kbps: u32) -> DesiredPeer {
        DesiredPeer {
            peer_id: Uuid::nil(),
            device_id: Uuid::nil(),
            user_id: Uuid::nil(),
            public_key: String::new(),
            preshared_key: String::new(),
            allowed_ips: vec![],
            addresses: vec!["10.0.0.2/32".to_string()],
            down_kbps,
            up_kbps,
        }
    }

    fn plan_for(interface: &DesiredInterface) -> DirectionPlan {
        TcShaper::plan(interface, Direction::Down).expect("plan")
    }

    fn limit(user_id: Uuid, down: u32, up: u32) -> UserLimit {
        UserLimit {
            user_id,
            group_down_kbps: down,
            group_up_kbps: up,
        }
    }

    fn peer_for(user_id: Uuid, address: u8, down: u32, up: u32) -> DesiredPeer {
        DesiredPeer {
            peer_id: Uuid::new_v4(),
            device_id: Uuid::new_v4(),
            user_id,
            public_key: String::new(),
            preshared_key: String::new(),
            allowed_ips: vec![],
            addresses: vec![format!("10.0.{address}.2/32")],
            down_kbps: down,
            up_kbps: up,
        }
    }

    fn with_device(mut peer: DesiredPeer, id: u128) -> DesiredPeer {
        peer.device_id = Uuid::from_u128(id);
        peer
    }

    #[test]
    fn shaping_is_not_needed_without_limits() {
        assert!(!shaping_needed(&interface(vec![], vec![peer(0, 0)])));
        assert!(!shaping_needed(&interface(vec![], vec![])));
        let zero = UserLimit {
            user_id: Uuid::nil(),
            group_down_kbps: 0,
            group_up_kbps: 0,
        };
        assert!(!shaping_needed(&interface(vec![zero], vec![peer(0, 0)])));
    }

    #[test]
    fn plan_includes_peer_with_group_limit_only() {
        let user = UserLimit {
            user_id: Uuid::nil(),
            group_down_kbps: 6000,
            group_up_kbps: 3000,
        };
        let iface = interface(vec![user], vec![peer(0, 0)]);
        assert_eq!(
            TcShaper::plan(&iface, Direction::Down)
                .unwrap()
                .filters
                .len(),
            1
        );
        assert_eq!(
            TcShaper::plan(&iface, Direction::Up).unwrap().filters.len(),
            1
        );
    }

    #[test]
    fn shaping_is_needed_for_user_or_peer_limits() {
        let user = UserLimit {
            user_id: Uuid::nil(),
            group_down_kbps: 1000,
            group_up_kbps: 500,
        };
        assert!(shaping_needed(&interface(vec![user], vec![])));
        let user = UserLimit {
            user_id: Uuid::nil(),
            group_down_kbps: 1000,
            group_up_kbps: 500,
        };
        assert!(shaping_needed(&interface(vec![user], vec![peer(100, 0)])));
        assert!(shaping_needed(&interface(vec![], vec![peer(0, 100)])));
    }

    #[test]
    fn canonical_users_are_sorted_and_deduplicated() {
        let first = Uuid::from_u128(1);
        let second = Uuid::from_u128(2);
        let iface = interface(
            vec![
                limit(second, 100, 100),
                limit(first, 100, 100),
                limit(second, 100, 100),
            ],
            vec![peer_for(first, 1, 1, 1), peer_for(second, 2, 1, 1)],
        );
        let users = TcShaper::canonical_users(&iface);
        assert_eq!(users, vec![(first, 100), (second, 101)]);
    }

    #[test]
    fn zero_rate_maps_to_the_explicit_link_capacity() {
        assert_eq!(TcShaper::rate(0), format!("{LINK_CAPACITY_KBPS}kbit"));
        assert_eq!(TcShaper::rate(1000), "1000kbit");
    }

    #[test]
    fn root_rate_uses_link_capacity_when_a_user_is_unlimited() {
        let limited = Uuid::from_u128(1);
        let unlimited = Uuid::from_u128(2);
        let iface = interface(
            vec![limit(limited, 1000, 1000), limit(unlimited, 0, 0)],
            vec![peer_for(limited, 1, 0, 0), peer_for(unlimited, 2, 0, 0)],
        );
        assert_eq!(
            TcShaper::root_rate(&iface, Direction::Down),
            LINK_CAPACITY_KBPS
        );
    }

    #[test]
    fn root_rate_is_the_sum_of_limited_users() {
        let first = Uuid::from_u128(1);
        let second = Uuid::from_u128(2);
        let iface = interface(
            vec![limit(first, 1000, 0), limit(second, 2500, 0)],
            vec![peer_for(first, 1, 0, 0), peer_for(second, 2, 0, 0)],
        );
        assert_eq!(TcShaper::root_rate(&iface, Direction::Down), 3500);
        assert_eq!(
            TcShaper::root_rate(&iface, Direction::Up),
            LINK_CAPACITY_KBPS
        );
    }

    #[test]
    fn classids_do_not_collide_for_150_peers_and_3_users() {
        let users: Vec<Uuid> = (1..=3).map(Uuid::from_u128).collect();
        let mut peers = Vec::new();
        for (user_index, user_id) in users.iter().enumerate() {
            for peer_index in 0..50u8 {
                let address = (user_index as u8) * 50 + peer_index + 1;
                peers.push(peer_for(*user_id, address, 1000, 1000));
            }
        }
        let limits = users
            .iter()
            .map(|user| limit(*user, 10_000, 10_000))
            .collect();
        let iface = interface(limits, peers);
        let plan = TcShaper::plan(&iface, Direction::Down).expect("plan");

        assert_eq!(plan.users.len(), 3);
        assert_eq!(plan.devices.len(), 150);
        assert_eq!(plan.filters.len(), 150);

        let user_classes: HashSet<u32> = plan.users.iter().map(|spec| spec.classid).collect();
        let device_classes: HashSet<u32> = plan.devices.iter().map(|spec| spec.classid).collect();
        assert_eq!(device_classes.len(), 150, "device classids must be unique");
        assert_eq!(user_classes.len(), 3, "user classids must be unique");
        assert!(
            device_classes.is_disjoint(&user_classes),
            "device classes must not shadow user classes"
        );
        assert!(
            device_classes.iter().all(|classid| *classid <= MAX_CLASSID),
            "classid exceeds the tc limit"
        );

        let handles: HashSet<u32> = plan.filters.iter().map(|filter| filter.handle).collect();
        assert_eq!(handles.len(), 150, "filter handles must be unique");
    }

    #[test]
    fn per_user_indexes_are_stable_when_peers_reorder() {
        let user = Uuid::from_u128(1);
        let first = peer_for(user, 1, 100, 100);
        let second = peer_for(user, 2, 100, 100);
        let limits = vec![limit(user, 10_000, 10_000)];

        let forward = interface(limits.clone(), vec![first.clone(), second.clone()]);
        let reverse = interface(limits, vec![second, first]);
        let forward_plan = TcShaper::plan(&forward, Direction::Down).expect("plan");
        let reverse_plan = TcShaper::plan(&reverse, Direction::Down).expect("plan");
        assert_eq!(forward_plan, reverse_plan);
    }

    #[test]
    fn identical_plan_is_not_reapplied() {
        let iface = interface(
            vec![limit(Uuid::from_u128(1), 1000, 1000)],
            vec![peer_for(Uuid::from_u128(1), 1, 100, 100)],
        );
        let plan = TcShaper::plan(&iface, Direction::Down).expect("plan");
        assert_eq!(
            TcShaper::plan_action(Some(&plan), &plan),
            PlanAction::Unchanged
        );
    }

    #[test]
    fn diff_only_changes_rates_and_filter_delta() {
        let user = Uuid::from_u128(1);
        let first = with_device(peer_for(user, 1, 100, 100), 1);
        let second = with_device(peer_for(user, 2, 200, 200), 2);
        let limits = vec![limit(user, 10_000, 10_000)];
        let previous = TcShaper::plan(
            &interface(limits.clone(), vec![first.clone(), second.clone()]),
            Direction::Down,
        )
        .expect("previous plan");

        let mut changed = first.clone();
        changed.down_kbps = 500;
        let third = with_device(peer_for(user, 3, 300, 300), 3);
        let next = TcShaper::plan(
            &interface(limits, vec![changed, second, third]),
            Direction::Down,
        )
        .expect("next plan");

        let commands = egress_diff_commands("awg0", &previous, &next);
        assert!(
            commands
                .iter()
                .all(|command| command.args.iter().all(|arg| arg != "qdisc")),
            "diff must not recreate the qdisc"
        );
        assert!(
            commands.iter().any(|command| {
                command.args[0] == "class"
                    && command.args[1] == "change"
                    && command.args.iter().any(|arg| arg == "1:1000")
            }),
            "changed rate must use class change: {commands:?}"
        );
        let added: Vec<&ShellCommand> = commands
            .iter()
            .filter(|command| command.args[0] == "filter" && command.args[1] == "replace")
            .collect();
        assert_eq!(added.len(), 1, "only the new filter is added");
        assert!(added[0].args.iter().any(|arg| arg == "10.0.3.2/32"));
    }

    #[test]
    fn diff_deletes_removed_filters_and_classes() {
        let user = Uuid::from_u128(1);
        let first = with_device(peer_for(user, 1, 100, 100), 1);
        let second = with_device(peer_for(user, 2, 200, 200), 2);
        let limits = vec![limit(user, 10_000, 10_000)];
        let previous = TcShaper::plan(
            &interface(limits.clone(), vec![first, second]),
            Direction::Down,
        )
        .expect("previous plan");
        let next = TcShaper::plan(
            &interface(limits, vec![with_device(peer_for(user, 1, 100, 100), 1)]),
            Direction::Down,
        )
        .expect("next plan");

        let commands = egress_diff_commands("awg0", &previous, &next);
        assert!(
            commands
                .iter()
                .any(|command| command.args[0] == "filter" && command.args[1] == "del"),
            "removed filter must be deleted"
        );
        assert!(
            commands.iter().any(|command| command.args[0] == "class"
                && command.args[1] == "del"
                && command.args.iter().any(|arg| arg == "1:1001")),
            "removed device class must be deleted: {commands:?}"
        );
    }

    #[test]
    fn ifb_name_is_deterministic_and_collision_free() {
        assert_eq!(ifb_name("awg-branch-01"), ifb_name("awg-branch-01"));
        assert_ne!(ifb_name("awg-branch-01"), ifb_name("awg-branch-02"));
        assert_ne!(ifb_name("awg0"), ifb_name("awg1"));
        for name in ["awg0", "verylongifacename", "awg-branch-01"] {
            let ifb = ifb_name(name);
            assert!(ifb.starts_with("ifb-"), "{ifb}");
            assert!(ifb.len() <= 15, "{ifb}");
        }
    }
}
