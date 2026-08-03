/**
 * Minimal WebSocket double for transport tests. Only implements the subset of the
 * WebSocket interface that src/transport/websocket.ts actually touches
 * (onopen/onmessage/onclose/onerror, send, close, readyState). Cast to `WebSocket`
 * at the injection site (`wsFactory`) — the real global `WebSocket.OPEN`/`CLOSED`
 * constants are used by production code, so `readyState` values below must match them.
 */
export class FakeWebSocket {
  static readonly CONNECTING = 0;
  static readonly OPEN = 1;
  static readonly CLOSING = 2;
  static readonly CLOSED = 3;

  readyState = FakeWebSocket.CONNECTING;
  onopen: (() => void) | null = null;
  onmessage: ((event: { data: string }) => void) | null = null;
  onclose: ((event: { code: number; reason: string }) => void) | null = null;
  onerror: (() => void) | null = null;

  readonly sent: string[] = [];
  closeCalls: Array<{ code?: number; reason?: string }> = [];

  constructor(readonly url: string) {}

  send(data: string): void {
    this.sent.push(data);
  }

  /** A real WebSocket eventually fires `onclose` even for a caller-initiated close(). */
  close(code = 1000, reason = ""): void {
    this.closeCalls.push({ code, reason });
    this.readyState = FakeWebSocket.CLOSED;
    this.onclose?.({ code, reason });
  }

  /** Test control: simulate the server accepting the connection. */
  simulateOpen(): void {
    this.readyState = FakeWebSocket.OPEN;
    this.onopen?.();
  }

  /** Test control: simulate a JSON server frame arriving. */
  simulateMessage(frame: unknown): void {
    this.onmessage?.({ data: JSON.stringify(frame) });
  }

  /** Test control: simulate the socket dying (network drop, server close, etc). */
  simulateClose(code = 1006, reason = "abnormal closure"): void {
    this.readyState = FakeWebSocket.CLOSED;
    this.onclose?.({ code, reason });
  }

  /** Test control: parse the last frame this socket sent, for assertions. */
  lastSentFrame<T = unknown>(): T {
    const raw = this.sent.at(-1);
    if (raw === undefined) throw new Error("FakeWebSocket: no frame has been sent yet");
    return JSON.parse(raw) as T;
  }
}

/** Creates a `wsFactory` that records every socket it constructs, in creation order. */
export function createFakeWsFactory() {
  const instances: FakeWebSocket[] = [];
  const factory = (url: string): WebSocket => {
    const socket = new FakeWebSocket(url);
    instances.push(socket);
    return socket as unknown as WebSocket;
  };
  return { factory, instances };
}
