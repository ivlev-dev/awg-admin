import { createPrivateKey, createPublicKey, randomBytes } from "node:crypto";

const X25519_PKCS8_PREFIX = Buffer.from("302e020100300506032b656e04220420", "hex");
const X25519_SPKI_PREFIX = Buffer.from("302a300506032b656e032100", "hex");

export interface WireGuardKeyPair {
  privateKey: string;
  publicKey: string;
}

export function generateKeyPair(): WireGuardKeyPair {
  const raw = randomBytes(32);
  const privateKey = createPrivateKey({
    key: Buffer.concat([X25519_PKCS8_PREFIX, raw]),
    format: "der",
    type: "pkcs8",
  });
  const exported = createPublicKey(privateKey).export({ format: "der", type: "spki" });
  const spki = Buffer.isBuffer(exported) ? exported : Buffer.from(exported);
  return {
    privateKey: raw.toString("base64"),
    publicKey: spki.subarray(X25519_SPKI_PREFIX.length).toString("base64"),
  };
}

export interface ServerPeerConfig {
  publicKey: string;
  allowedIps: string;
  presharedKey?: string;
}

export interface ServerConfigInput {
  privateKey: string;
  address?: string;
  listenPort?: number;
  mtu?: number;
  peers?: ServerPeerConfig[];
}

export function serverConfig(input: ServerConfigInput): string {
  const lines = [
    "[Interface]",
    `PrivateKey = ${input.privateKey}`,
    `Address = ${input.address ?? "10.0.0.1/24"}`,
    `ListenPort = ${input.listenPort ?? 51820}`,
    `MTU = ${input.mtu ?? 1420}`,
  ];
  for (const peer of input.peers ?? []) {
    lines.push("", "[Peer]", `PublicKey = ${peer.publicKey}`);
    if (peer.presharedKey) lines.push(`PresharedKey = ${peer.presharedKey}`);
    lines.push(`AllowedIPs = ${peer.allowedIps}`);
  }
  return lines.join("\n");
}

export interface ClientConfigInput {
  privateKey: string;
  address: string;
  serverPublicKey: string;
  endpoint?: string;
  dns?: string;
  allowedIps?: string;
}

export function clientConfig(input: ClientConfigInput): string {
  return [
    "[Interface]",
    `PrivateKey = ${input.privateKey}`,
    `Address = ${input.address}`,
    `DNS = ${input.dns ?? "1.1.1.1"}`,
    `MTU = 1420`,
    "",
    "[Peer]",
    `PublicKey = ${input.serverPublicKey}`,
    `Endpoint = ${input.endpoint ?? "e2e.example.com:51820"}`,
    `AllowedIPs = ${input.allowedIps ?? "0.0.0.0/0, ::/0"}`,
    "PersistentKeepalive = 25",
  ].join("\n");
}
