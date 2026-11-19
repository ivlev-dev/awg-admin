export type StatusTone = "ok" | "warn" | "error" | "info" | "neutral";

export function clientTone(status: string): StatusTone {
  switch (status) {
    case "create":
      return "ok";
    case "update":
      return "info";
    case "duplicate":
      return "warn";
    case "error":
      return "error";
    default:
      return "neutral";
  }
}

export function peerTone(status: string): StatusTone {
  switch (status) {
    case "create":
      return "ok";
    case "duplicate":
      return "warn";
    case "error":
      return "error";
    default:
      return "neutral";
  }
}
