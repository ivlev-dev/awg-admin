use std::io::Write;
use std::process::{Child, Command, Stdio};
use std::time::Duration;

use awg_worker::domain::{
    DesiredInterface, DesiredPeer, DesiredState, ForwardingRule, UserLimit, WireObf,
};
use awg_worker::{
    AwgControl, FileCounterRepository, ForwardingControl, NetlinkAwg, NftForwarding,
    ReconcileService, TcShaper, TrafficShaper,
};
use uuid::Uuid;

const DEV: &str = "awgtest0";
const PEER_DEV: &str = "awgpeer0";
const ADDR: &str = "10.250.0.1/32";
const PEER_ADDR: &str = "10.250.1.1/32";
const PEER_NET: &str = "10.250.1.0/24";
const TRANSPORT_LOCAL: &str = "10.40.2.1";
const TRANSPORT_PEER: &str = "10.40.2.2";
const PEER_PORT: u16 = 51821;

struct Netns(Child);

impl Drop for Netns {
    fn drop(&mut self) {
        let _ = self.0.kill();
        let _ = self.0.wait();
    }
}

fn output(program: &str, args: &[&str]) -> std::io::Result<std::process::Output> {
    Command::new(program).args(args).output()
}

fn expect_ok(program: &str, args: &[&str]) -> String {
    let out =
        output(program, args).unwrap_or_else(|e| panic!("failed to spawn {program} {args:?}: {e}"));
    assert!(
        out.status.success(),
        "{program} {args:?} failed: {}",
        String::from_utf8_lossy(&out.stderr).trim()
    );
    String::from_utf8_lossy(&out.stdout).into_owned()
}

fn best_effort(program: &str, args: &[&str]) {
    let _ = output(program, args);
}

fn skip_unless_privileged() -> bool {
    if output("awg", &["--version"]).is_err() {
        eprintln!("skip: awg tool is missing");
        return false;
    }
    if output("tc", &["-V"]).is_err() {
        eprintln!("skip: tc tool is missing");
        return false;
    }
    let probe = output(
        "ip",
        &[
            "link", "add", "nlprobe0", "type", "veth", "peer", "name", "nlprobe1",
        ],
    );
    let privileged = probe.map(|o| o.status.success()).unwrap_or(false);
    if privileged {
        best_effort("ip", &["link", "del", "nlprobe0"]);
    } else {
        eprintln!("skip: CAP_NET_ADMIN is required (run under unshare -rn)");
    }
    privileged
}

fn awg_keypair() -> (String, String) {
    let private = expect_ok("awg", &["genkey"]).trim().to_string();
    let mut child = Command::new("awg")
        .arg("pubkey")
        .stdin(Stdio::piped())
        .stdout(Stdio::piped())
        .spawn()
        .expect("spawn awg pubkey");
    child
        .stdin
        .as_mut()
        .expect("stdin")
        .write_all(private.as_bytes())
        .expect("write private key");
    let out = child.wait_with_output().expect("awg pubkey output");
    assert!(out.status.success(), "awg pubkey failed");
    let public = String::from_utf8_lossy(&out.stdout).trim().to_string();
    (private, public)
}

#[allow(clippy::zombie_processes)]
fn spawn_netns() -> Netns {
    let child = Command::new("unshare")
        .args(["--net", "--", "sleep", "120"])
        .spawn()
        .expect("spawn unshare --net");
    let pid = child.id();
    let own = std::fs::read_link("/proc/self/ns/net").expect("read own netns");
    for _ in 0..100 {
        if let Ok(ns) = std::fs::read_link(format!("/proc/{pid}/ns/net"))
            && ns != own
        {
            return Netns(child);
        }
        std::thread::sleep(Duration::from_millis(50));
    }
    panic!("nested netns did not start");
}

fn peer_conf(
    private_key: &str,
    peer_key: &str,
    listen_port: u16,
    listen_peer: bool,
    allowed_ips: &str,
    peer_endpoint: Option<&str>,
) -> String {
    let keepalive = if listen_peer {
        String::new()
    } else {
        "PersistentKeepalive = 5\n".to_string()
    };
    let endpoint = peer_endpoint
        .map(|value| format!("Endpoint = {value}\n"))
        .unwrap_or_default();
    format!(
        "[Interface]\nPrivateKey = {private_key}\nListenPort = {listen_port}\n\
S1 = 15\nS2 = 16\nS3 = 17\nS4 = 18\n\
H1 = 100100-100200\nH2 = 1000100-1000200\nH3 = 2000100-2000200\nH4 = 3000100-3000200\n\
RandomTrailers = on\n\n[Peer]\nPublicKey = {peer_key}\nAllowedIPs = {allowed_ips}\n{endpoint}{keepalive}"
    )
}

fn obf() -> WireObf {
    WireObf {
        h1: "100100-100200".to_string(),
        h2: "1000100-1000200".to_string(),
        h3: "2000100-2000200".to_string(),
        h4: "3000100-3000200".to_string(),
        s1: 15,
        s2: 16,
        s3: 17,
        s4: 18,
        header_protection_key: String::new(),
        random_trailers: true,
    }
}

fn desired_peer(public_key: &str, address: &str, user_id: Uuid, device_id: Uuid) -> DesiredPeer {
    DesiredPeer {
        device_id,
        user_id,
        public_key: public_key.to_string(),
        preshared_key: String::new(),
        allowed_ips: vec![PEER_NET.to_string()],
        addresses: vec![address.to_string()],
        down_kbps: 0,
        up_kbps: 0,
    }
}

fn desired_interface(private_key: &str, peer_key: &str, peer_id: Uuid) -> DesiredInterface {
    DesiredInterface {
        id: Uuid::nil(),
        name: DEV.to_string(),
        listen_port: 51820,
        mtu: 1420,
        private_key: private_key.to_string(),
        public_key: String::new(),
        enabled: true,
        obf: obf(),
        addresses: vec![ADDR.to_string()],
        peers: vec![desired_peer(peer_key, PEER_ADDR, Uuid::nil(), peer_id)],
        group_down_kbps: 0,
        group_up_kbps: 0,
        user_limits: Vec::new(),
        forwarding: Vec::<ForwardingRule>::new(),
    }
}

#[tokio::test]
#[ignore = "requires CAP_NET_ADMIN, amneziawg module and awg/tc tools; run under unshare -rn"]
async fn live_dump_reads_counters_and_reapply_is_idempotent() {
    if !skip_unless_privileged() {
        return;
    }

    let (private_local, public_local) = awg_keypair();
    let (private_peer, public_peer) = awg_keypair();

    let netns = spawn_netns();
    let pid = netns.0.id();

    let conf = format!("/tmp/awg-worker-live-{pid}.conf");
    std::fs::write(
        &conf,
        peer_conf(
            &private_peer,
            &public_local,
            PEER_PORT,
            false,
            "10.250.0.0/24",
            Some(&format!("{TRANSPORT_LOCAL}:51820")),
        ),
    )
    .expect("write peer config");

    expect_ok(
        "ip",
        &[
            "link", "add", "nl-veth0", "type", "veth", "peer", "name", "nl-veth1",
        ],
    );
    expect_ok(
        "ip",
        &[
            "addr",
            "add",
            &format!("{TRANSPORT_LOCAL}/24"),
            "dev",
            "nl-veth0",
        ],
    );
    expect_ok("ip", &["link", "set", "nl-veth0", "up"]);
    expect_ok(
        "ip",
        &["link", "set", "nl-veth1", "netns", &pid.to_string()],
    );

    let peer_setup = format!(
        "set -e\n\
         ip link set nl-veth1 up\n\
         ip addr add {TRANSPORT_PEER}/24 dev nl-veth1\n\
         ip route add default via {TRANSPORT_LOCAL}\n\
         sysctl -qw net.ipv4.conf.all.rp_filter=0\n\
         ip link add dev {PEER_DEV} type amneziawg\n\
         ip addr add {PEER_ADDR} dev {PEER_DEV}\n\
         ip link set dev {PEER_DEV} mtu 1420 up\n\
         ip route add 10.250.0.0/24 dev {PEER_DEV}\n\
         awg setconf {PEER_DEV} {conf}\n"
    );
    expect_ok(
        "nsenter",
        &["-t", &pid.to_string(), "-n", "bash", "-c", &peer_setup],
    );

    let interface = desired_interface(&private_local, &public_peer, Uuid::new_v4());
    let state = DesiredState {
        revision: "live".to_string(),
        interfaces: vec![interface.clone()],
    };
    let counter_path = format!("/tmp/awg-worker-live-{pid}-counters.json");
    let service = ReconcileService::new(
        Box::new(NetlinkAwg::new(false)),
        Box::new(TcShaper::new(false)),
        Box::new(NftForwarding::new(false)),
        Box::new(FileCounterRepository::new(&counter_path)),
    )
    .expect("reconcile service");
    service.apply(&state).await.expect("initial reconcile");
    expect_ok("ip", &["route", "add", PEER_NET, "dev", DEV]);

    let awg = NetlinkAwg::new(false);
    let mut runtime = None;
    for _ in 0..25 {
        best_effort(
            "nsenter",
            &[
                "-t",
                &pid.to_string(),
                "-n",
                "ping",
                "-c",
                "3",
                "-W",
                "1",
                "-i",
                "0.2",
                "-I",
                PEER_DEV,
                "10.250.0.1",
            ],
        );
        let current = awg
            .read_interface(&interface)
            .await
            .expect("read_interface must not fail (regression: os error 95)");
        if current
            .peers
            .iter()
            .any(|peer| peer.rx_bytes > 0 && peer.tx_bytes > 0)
        {
            runtime = Some(current);
            break;
        }
        tokio::time::sleep(Duration::from_secs(1)).await;
    }

    let runtime = runtime.expect("counters did not grow after traffic");
    assert_eq!(runtime.peers.len(), 1);
    assert_eq!(runtime.peers[0].public_key, public_peer);
    assert!(
        runtime.peers[0].last_handshake > 0,
        "last handshake must be reported by the dump"
    );

    let before = service.collect(&state).await.expect("stats after traffic");
    let before_peer = &before.interfaces[0].peers[0];
    assert!(before_peer.rx_total > 0, "stats must grow after traffic");

    service.apply(&state).await.expect("second reconcile");
    let after = service.collect(&state).await.expect("second stats");
    let after_peer = &after.interfaces[0].peers[0];
    assert!(
        after_peer.rx_total >= before_peer.rx_total,
        "monotonic total after REPLACE_PEERS: {} < {}",
        after_peer.rx_total,
        before_peer.rx_total
    );

    let again = awg.read_interface(&interface).await.expect("second dump");
    assert_eq!(again.peers.len(), 1, "peer must survive REPLACE_PEERS");
    assert_eq!(again.peers[0].public_key, public_peer);

    best_effort("ip", &["link", "del", DEV]);
    best_effort("ip", &["link", "del", "nl-veth0"]);
}

fn tc_interface(dev: &str) -> DesiredInterface {
    let user_id = Uuid::new_v4();
    let peers = vec![
        DesiredPeer {
            device_id: Uuid::new_v4(),
            user_id,
            public_key: String::new(),
            preshared_key: String::new(),
            allowed_ips: Vec::new(),
            addresses: vec!["10.77.0.2/32".to_string()],
            down_kbps: 1000,
            up_kbps: 1000,
        },
        DesiredPeer {
            device_id: Uuid::new_v4(),
            user_id,
            public_key: String::new(),
            preshared_key: String::new(),
            allowed_ips: Vec::new(),
            addresses: vec!["10.77.0.3/32".to_string()],
            down_kbps: 1000,
            up_kbps: 1000,
        },
    ];
    DesiredInterface {
        id: Uuid::new_v4(),
        name: dev.to_string(),
        listen_port: 0,
        mtu: 1420,
        private_key: String::new(),
        public_key: String::new(),
        enabled: true,
        obf: obf(),
        addresses: Vec::new(),
        peers,
        group_down_kbps: 10_000,
        group_up_kbps: 10_000,
        user_limits: vec![UserLimit {
            user_id,
            group_down_kbps: 10_000,
            group_up_kbps: 10_000,
        }],
        forwarding: Vec::new(),
    }
}

#[tokio::test]
#[ignore = "requires CAP_NET_ADMIN and tc; run under unshare -rn"]
async fn live_tc_reapply_is_idempotent() {
    if !skip_unless_privileged() {
        return;
    }

    expect_ok(
        "ip",
        &[
            "link", "add", "tcdev0", "type", "veth", "peer", "name", "tcpeer0",
        ],
    );
    expect_ok("ip", &["link", "set", "tcdev0", "up"]);
    expect_ok("ip", &["link", "set", "tcpeer0", "up"]);

    let interface = tc_interface("tcdev0");
    let shaper = TcShaper::new(false);
    shaper.apply(&interface).await.expect("first tc apply");
    shaper
        .apply(&interface)
        .await
        .expect("second tc apply must not hit 'Change operation not supported'");

    let qdisc = expect_ok("tc", &["qdisc", "show", "dev", "tcdev0"]);
    assert!(qdisc.contains("qdisc htb 1:"), "missing root htb: {qdisc}");
    assert!(qdisc.contains("ingress"), "missing ingress qdisc: {qdisc}");

    let classes = expect_ok("tc", &["class", "show", "dev", "tcdev0"]);
    for classid in ["1:1", "1:100", "1:1000", "1:1001"] {
        assert!(
            classes.contains(classid),
            "missing class {classid}: {classes}"
        );
    }

    let filters = expect_ok("tc", &["filter", "show", "dev", "tcdev0", "parent", "1:"]);
    assert_eq!(
        filters.matches("flowid 1:1000").count(),
        1,
        "reconcile must not duplicate egress filters: {filters}"
    );
    assert_eq!(filters.matches("flowid 1:1001").count(), 1);

    let ingress = expect_ok(
        "tc",
        &["filter", "show", "dev", "tcdev0", "parent", "ffff:"],
    );
    assert_eq!(
        ingress.matches("mirred").count(),
        1,
        "reconcile must not duplicate ingress filters: {ingress}"
    );

    let ifb = expect_ok("tc", &["qdisc", "show", "dev", "ifb-tcdev0"]);
    assert!(ifb.contains("qdisc htb 1:"), "missing ifb htb: {ifb}");

    shaper.clear("tcdev0").await.expect("clear tc");
    let cleared = expect_ok("tc", &["qdisc", "show", "dev", "tcdev0"]);
    assert!(
        !cleared.contains("qdisc htb"),
        "clear must remove htb: {cleared}"
    );

    best_effort("ip", &["link", "del", "tcdev0"]);
}

#[tokio::test]
#[ignore = "requires CAP_NET_ADMIN and nft; run under unshare -rn"]
async fn live_nft_reapply_is_idempotent() {
    if !skip_unless_privileged() {
        return;
    }
    if output("nft", &["--version"]).is_err() {
        eprintln!("skip: nft is missing");
        return;
    }

    let mut interface = tc_interface("nftdev0");
    interface.forwarding = vec![ForwardingRule {
        from_device_id: Uuid::new_v4(),
        to_device_id: Uuid::new_v4(),
        from_ip: "10.77.0.2".to_string(),
        to_ip: "10.77.0.3".to_string(),
    }];

    let nft = NftForwarding::new(false);
    nft.apply(&interface).await.expect("first nft apply");
    nft.apply(&interface).await.expect("second nft apply");

    let chain = expect_ok(
        "nft",
        &["list", "chain", "inet", "awg_admin", "fwd_nftdev0"],
    );
    assert!(chain.contains("accept"), "missing accept rule: {chain}");
    assert_eq!(
        chain.matches("drop").count(),
        1,
        "reapply must not duplicate the drop rule: {chain}"
    );

    nft.clear("nftdev0").await.expect("clear nft");
}
