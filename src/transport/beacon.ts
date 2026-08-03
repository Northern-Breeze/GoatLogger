import type { LogBatch, Transport } from "../core/types";

export interface BeaconTransport extends Transport {
  /**
   * Synchronous last-gasp send via navigator.sendBeacon, used on page unload
   * when fetch/WS delivery can no longer be relied on to complete.
   * Returns whether the browser accepted the beacon.
   */
  beacon(batch: LogBatch): boolean;
}

export function withBeaconFallback(
  transport: Transport,
  endpoint: string | undefined,
  authToken?: string
): BeaconTransport {
  return {
    send: (batch) => transport.send(batch),
    flush: () => transport.flush?.(),

    beacon(batch: LogBatch): boolean {
      if (!endpoint || batch.entries.length === 0) return false;
      if (typeof navigator === "undefined" || typeof navigator.sendBeacon !== "function") {
        return false;
      }

      // sendBeacon can't set an Authorization header, so carry the token as a query
      // param — the wire payload itself must stay exactly { entries, sentAt }.
      const url = authToken
        ? `${endpoint}${endpoint.includes("?") ? "&" : "?"}token=${encodeURIComponent(authToken)}`
        : endpoint;
      const blob = new Blob([JSON.stringify(batch)], { type: "application/json" });
      return navigator.sendBeacon(url, blob);
    },
  };
}
