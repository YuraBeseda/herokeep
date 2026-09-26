import { WS_MESSAGE_BYTES_MAX, type ClientMessage, type ServerMessage } from '@hk/protocol';
import {
  SyncSocket,
  SyncSocketOversizeError,
  wsUrl,
  wsUrlForStream,
  type WebSocketLike,
} from './socket';

type Handler = ((event: unknown) => void) | null;

/** Constructor-injectable fake standing in for the browser's native `WebSocket` (see
 * `WebSocketLike` in socket.ts for the exact narrow surface `SyncSocket` depends on). Records the
 * url it was constructed with and every payload passed to `send()` so specs can assert on them,
 * and exposes `emitOpen`/`emitMessage`/`emitClose` helpers to drive the fake from the outside
 * like a real socket would from network events. */
class FakeWebSocket implements WebSocketLike {
  static instances: FakeWebSocket[] = [];

  readonly url: string;
  readonly sent: (string | Uint8Array)[] = [];
  closeCalls: { code?: number; reason?: string }[] = [];
  binaryType: 'blob' | 'arraybuffer' | undefined;

  onopen: (() => void) | null = null;
  onclose: Handler = null;
  onerror: Handler = null;
  onmessage: Handler = null;

  constructor(url: string) {
    this.url = url;
    FakeWebSocket.instances.push(this);
  }

  send(data: string | Uint8Array): void {
    this.sent.push(data);
  }

  close(code?: number, reason?: string): void {
    this.closeCalls.push({ code, reason });
    this.onclose?.({ code: code ?? 1000, reason: reason ?? '' });
  }

  emitOpen(): void {
    this.onopen?.();
  }

  emitMessage(data: unknown): void {
    this.onmessage?.({ data });
  }
}

function factory(): new (url: string) => WebSocketLike {
  FakeWebSocket.instances = [];
  return FakeWebSocket;
}

function validServerMessage(): ServerMessage {
  return {
    t: 'ack',
    rid: 'r1',
    results: [{ id: '11111111-1111-4111-8111-111111111111', seq: 1 }],
  };
}

describe('wsUrl', () => {
  it('builds a ws:// url from an http:// location', () => {
    const url = wsUrl('char-1', { protocol: 'http:', host: 'localhost:4200' });

    expect(url).toBe('ws://localhost:4200/api/characters/char-1/ws');
  });

  it('builds a wss:// url from an https:// location', () => {
    const url = wsUrl('char-1', { protocol: 'https:', host: 'herokeep.example' });

    expect(url).toBe('wss://herokeep.example/api/characters/char-1/ws');
  });
});

describe('wsUrlForStream', () => {
  it('maps a char: stream id to /api/characters/<id>/ws', () => {
    const url = wsUrlForStream('char:char-1', { protocol: 'http:', host: 'localhost:4200' });

    expect(url).toBe('ws://localhost:4200/api/characters/char-1/ws');
  });

  it('maps a camp: stream id to /api/campaigns/<id>/ws', () => {
    const url = wsUrlForStream('camp:camp-1', { protocol: 'http:', host: 'localhost:4200' });

    expect(url).toBe('ws://localhost:4200/api/campaigns/camp-1/ws');
  });

  it('maps https: to wss: for a campaign stream too', () => {
    const url = wsUrlForStream('camp:camp-1', { protocol: 'https:', host: 'herokeep.example' });

    expect(url).toBe('wss://herokeep.example/api/campaigns/camp-1/ws');
  });

  it('throws for a stream id with neither a char: nor camp: prefix', () => {
    expect(() => wsUrlForStream('bogus:x', { protocol: 'http:', host: 'localhost:4200' })).toThrow(
      /bogus:x/,
    );
  });

  it('wsUrl(characterId) delegates to wsUrlForStream with a char: prefix', () => {
    const viaWsUrl = wsUrl('char-1', { protocol: 'https:', host: 'herokeep.example' });
    const viaWsUrlForStream = wsUrlForStream('char:char-1', {
      protocol: 'https:',
      host: 'herokeep.example',
    });

    expect(viaWsUrl).toBe(viaWsUrlForStream);
  });
});

describe('SyncSocket', () => {
  it('opens a WebSocket at the given url via the injected factory', () => {
    const Factory = factory();
    new SyncSocket({ url: 'wss://example/api/characters/c1/ws', webSocketFactory: Factory });

    expect(FakeWebSocket.instances).toHaveLength(1);
    expect(FakeWebSocket.instances[0].url).toBe('wss://example/api/characters/c1/ws');
  });

  it('invokes onOpen when the underlying socket opens', () => {
    const Factory = factory();
    const onOpen = vi.fn();
    new SyncSocket({ url: 'wss://x', webSocketFactory: Factory, onOpen });

    FakeWebSocket.instances[0].emitOpen();

    expect(onOpen).toHaveBeenCalledTimes(1);
  });

  it('send() JSON-serializes a ClientMessage and writes it to the socket', () => {
    const Factory = factory();
    const socket = new SyncSocket({ url: 'wss://x', webSocketFactory: Factory });
    const message: ClientMessage = { t: 'presence', state: 'active' };

    socket.send(message);

    expect(FakeWebSocket.instances[0].sent).toEqual([JSON.stringify(message)]);
  });

  it('send() throws SyncSocketOversizeError instead of sending when the encoded message exceeds 128 KB, and never writes to the socket', () => {
    const Factory = factory();
    const socket = new SyncSocket({ url: 'wss://x', webSocketFactory: Factory });
    // A single oversized payload well past the 128 KB frame cap. `send()` only measures the
    // encoded byte length (no outgoing schema validation — that's the server's job on receipt),
    // so a loosely-shaped object cast to ClientMessage is enough to exercise the guard.
    const oversizedMessage = {
      t: 'append',
      rid: 'r1',
      events: [{ blob: 'a'.repeat(WS_MESSAGE_BYTES_MAX) }],
    } as unknown as ClientMessage;

    expect(() => socket.send(oversizedMessage)).toThrow(SyncSocketOversizeError);
    expect(FakeWebSocket.instances[0].sent).toEqual([]);
  });

  it('dispatches a valid ServerMessage frame to onMessage', () => {
    const Factory = factory();
    const onMessage = vi.fn();
    const socket = new SyncSocket({ url: 'wss://x', webSocketFactory: Factory, onMessage });
    const message = validServerMessage();

    FakeWebSocket.instances[0].emitMessage(JSON.stringify(message));

    expect(onMessage).toHaveBeenCalledWith(message);
    void socket;
  });

  it('closes the socket and calls onProtocolError (never onMessage) on invalid JSON, without throwing', () => {
    const Factory = factory();
    const onMessage = vi.fn();
    const onProtocolError = vi.fn();
    new SyncSocket({ url: 'wss://x', webSocketFactory: Factory, onMessage, onProtocolError });

    expect(() => FakeWebSocket.instances[0].emitMessage('{not json')).not.toThrow();

    expect(onMessage).not.toHaveBeenCalled();
    expect(onProtocolError).toHaveBeenCalledTimes(1);
    expect(FakeWebSocket.instances[0].closeCalls).toHaveLength(1);
  });

  it('closes the socket and calls onProtocolError (never onMessage) on schema-invalid frames, without throwing', () => {
    const Factory = factory();
    const onMessage = vi.fn();
    const onProtocolError = vi.fn();
    new SyncSocket({ url: 'wss://x', webSocketFactory: Factory, onMessage, onProtocolError });

    expect(() =>
      FakeWebSocket.instances[0].emitMessage(JSON.stringify({ t: 'not-a-real-type' })),
    ).not.toThrow();

    expect(onMessage).not.toHaveBeenCalled();
    expect(onProtocolError).toHaveBeenCalledTimes(1);
    expect(FakeWebSocket.instances[0].closeCalls).toHaveLength(1);
  });

  it('invokes onClose (with code/reason) when the underlying socket closes', () => {
    const Factory = factory();
    const onClose = vi.fn();
    const socket = new SyncSocket({ url: 'wss://x', webSocketFactory: Factory, onClose });

    socket.close();

    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it('invokes onError when the underlying socket errors', () => {
    const Factory = factory();
    const onError = vi.fn();
    new SyncSocket({ url: 'wss://x', webSocketFactory: Factory, onError });

    FakeWebSocket.instances[0].onerror?.({ message: 'boom' });

    expect(onError).toHaveBeenCalledTimes(1);
  });

  it('close() closes the underlying socket', () => {
    const Factory = factory();
    const socket = new SyncSocket({ url: 'wss://x', webSocketFactory: Factory });

    socket.close();

    expect(FakeWebSocket.instances[0].closeCalls).toHaveLength(1);
  });

  it('sets binaryType to arraybuffer on the underlying socket so incoming binary frames never arrive as a Blob', () => {
    const Factory = factory();
    new SyncSocket({ url: 'wss://x', webSocketFactory: Factory });

    expect(FakeWebSocket.instances[0].binaryType).toBe('arraybuffer');
  });

  it('sendBinary() writes raw bytes straight to the socket (no JSON envelope)', () => {
    const Factory = factory();
    const socket = new SyncSocket({ url: 'wss://x', webSocketFactory: Factory });
    const bytes = new Uint8Array([1, 2, 3, 4]);

    socket.sendBinary(bytes);

    expect(FakeWebSocket.instances[0].sent).toEqual([bytes]);
  });

  it('sendBinary() throws SyncSocketOversizeError instead of sending when bytes exceed 128 KB, and never writes to the socket', () => {
    const Factory = factory();
    const socket = new SyncSocket({ url: 'wss://x', webSocketFactory: Factory });
    const oversized = new Uint8Array(WS_MESSAGE_BYTES_MAX + 1);

    expect(() => socket.sendBinary(oversized)).toThrow(SyncSocketOversizeError);
    expect(FakeWebSocket.instances[0].sent).toEqual([]);
  });

  it('dispatches an incoming ArrayBuffer frame to onBinaryFrame as a Uint8Array, WITHOUT attempting JSON parse (never calls onMessage/onProtocolError)', () => {
    const Factory = factory();
    const onMessage = vi.fn();
    const onProtocolError = vi.fn();
    const onBinaryFrame = vi.fn();
    new SyncSocket({
      url: 'wss://x',
      webSocketFactory: Factory,
      onMessage,
      onProtocolError,
      onBinaryFrame,
    });
    const bytes = new Uint8Array([9, 8, 7]).buffer;

    FakeWebSocket.instances[0].emitMessage(bytes);

    expect(onBinaryFrame).toHaveBeenCalledTimes(1);
    const [received] = onBinaryFrame.mock.calls[0] as [Uint8Array];
    expect(received).toBeInstanceOf(Uint8Array);
    expect(Array.from(received)).toEqual([9, 8, 7]);
    expect(onMessage).not.toHaveBeenCalled();
    expect(onProtocolError).not.toHaveBeenCalled();
  });

  it('dispatches an incoming Uint8Array (ArrayBufferView) frame to onBinaryFrame too', () => {
    const Factory = factory();
    const onBinaryFrame = vi.fn();
    new SyncSocket({ url: 'wss://x', webSocketFactory: Factory, onBinaryFrame });
    const bytes = new Uint8Array([5, 6]);

    FakeWebSocket.instances[0].emitMessage(bytes);

    expect(onBinaryFrame).toHaveBeenCalledTimes(1);
    const [received] = onBinaryFrame.mock.calls[0] as [Uint8Array];
    expect(Array.from(received)).toEqual([5, 6]);
  });

  it('a binary frame arriving with no onBinaryFrame handler configured is silently ignored (no throw)', () => {
    const Factory = factory();
    new SyncSocket({ url: 'wss://x', webSocketFactory: Factory });

    expect(() => FakeWebSocket.instances[0].emitMessage(new Uint8Array([1]).buffer)).not.toThrow();
  });
});
