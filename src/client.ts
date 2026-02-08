import { WS_URL } from "./config.ts";
import { now, random_id } from "./helpers.ts";
import type { RoomPost } from "./shared.ts";

type TimeSync = {
  clock_offset: number;
  lowest_ping: number;
  request_sent_at: number;
  last_ping: number;
};

const time_sync: TimeSync = {
  clock_offset: Infinity,
  lowest_ping: Infinity,
  request_sent_at: 0,
  last_ping: Infinity,
};

const ws = new WebSocket(WS_URL);

type MessageHandler = (message: any) => void;
const room_watchers = new Map<string, MessageHandler>();

let is_open = false;
const open_listeners: Array<() => void> = [];
let is_synced = false;
const sync_listeners: Array<() => void> = [];

export function server_time(): number {
  if (!isFinite(time_sync.clock_offset)) {
    throw new Error("server_time() called before initial sync");
  }
  return Math.floor(now() + time_sync.clock_offset);
}

function ensure_open(): void {
  if (ws.readyState !== WebSocket.OPEN) {
    throw new Error("WebSocket not open");
  }
}

export function send(obj: any): void {
  ensure_open();
  ws.send(JSON.stringify(obj));
}

function register_handler(room: string, handler?: MessageHandler): void {
  if (!handler) {
    return;
  }

  if (room_watchers.has(room)) {
    throw new Error(`Handler already registered for room: ${room}`);
  }

  room_watchers.set(room, handler);
}

ws.addEventListener("open", () => {
  is_open = true;
  for (const cb of open_listeners) {
    cb();
  }
  open_listeners.length = 0;
  console.log(`[WS] Connected to ${WS_URL}`);
  time_sync.request_sent_at = now();
  ws.send(JSON.stringify({ $: "get_time" }));
  setInterval(() => {
    time_sync.request_sent_at = now();
    ws.send(JSON.stringify({ $: "get_time" }));
  }, 2000);
});

ws.addEventListener("message", (event) => {
  const msg = JSON.parse(event.data);

  switch (msg.$) {
    case "info_time": {
      const t = now();
      const ping = t - time_sync.request_sent_at;

      time_sync.last_ping = ping;

      if (ping < time_sync.lowest_ping) {
        const local_avg = Math.floor((time_sync.request_sent_at + t) / 2);
        time_sync.clock_offset = msg.time - local_avg;
        time_sync.lowest_ping = ping;
      }

      if (!is_synced) {
        is_synced = true;
        for (const cb of sync_listeners) {
          cb();
        }
        sync_listeners.length = 0;
      }
      break;
    }

    case "info_post": {
      const handler = room_watchers.get(msg.room);
      if (handler) {
        handler(msg);
      }
      break;
    }
  }
});

export function gen_name(): string {
  const alphabet = "_abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789-";
  const can_crypto = typeof crypto !== "undefined" && typeof crypto.getRandomValues === "function";
  const source = can_crypto ? { fillBytes: (bytes: Uint8Array) => crypto.getRandomValues(bytes) } : undefined;
  return random_id(8, alphabet, source);
}

export function post(room: string, data: RoomPost): string {
  const name = gen_name();
  const time = isFinite(time_sync.clock_offset) ? server_time() : now();
  send({ $: "post", room, time, name, data });
  return name;
}

export function load(room: string, from: number = 0, handler?: MessageHandler): void {
  register_handler(room, handler);
  send({ $: "load", room, from });
}

export function watch(room: string, handler?: MessageHandler): void {
  register_handler(room, handler);
  send({ $: "watch", room });
}

export function unwatch(room: string): void {
  room_watchers.delete(room);
  send({ $: "unwatch", room });
}

export function close(): void {
  ws.close();
}

export function on_sync(callback: () => void): void {
  if (is_synced) {
    callback();
    return;
  }
  sync_listeners.push(callback);
}

export function on_open(callback: () => void): void {
  if (is_open) {
    callback();
    return;
  }
  open_listeners.push(callback);
}

export function ping(): number {
  return time_sync.last_ping;
}
