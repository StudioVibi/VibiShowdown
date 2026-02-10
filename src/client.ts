import { WS_URL } from "./config.ts";
import { create_client, gen_name } from "./vibinet/client.ts";
import type { Packed } from "./vibinet/packer.ts";
import type { RoomPost } from "./shared.ts";

type MessageHandler = (message: {
  $: "info_post";
  room: string;
  index: number;
  server_time: number;
  client_time: number;
  name: string;
  data: RoomPost;
}) => void;

const ROOM_POST_PACKER: Packed = { $: "String" };
const client = create_client<string>(WS_URL);
const room_watchers = new Map<string, MessageHandler>();

function decode_room_post(raw: unknown): RoomPost | null {
  if (typeof raw !== "string") {
    return null;
  }
  try {
    const parsed = JSON.parse(raw) as RoomPost;
    if (!parsed || typeof parsed !== "object" || typeof parsed.$ !== "string") {
      return null;
    }
    return parsed;
  } catch {
    return null;
  }
}

function emit_if_valid(room: string, message: any): void {
  if (!message || message.$ !== "info_post") {
    return;
  }
  const data = decode_room_post(message.data);
  if (!data) {
    return;
  }
  const handler = room_watchers.get(room);
  if (!handler) {
    return;
  }
  handler({
    $: "info_post",
    room: message.room,
    index: message.index,
    server_time: message.server_time,
    client_time: message.client_time,
    name: message.name,
    data,
  });
}

export { gen_name };

export function server_time(): number {
  return client.server_time();
}

export function post(room: string, data: RoomPost): string {
  return client.post(room, JSON.stringify(data), ROOM_POST_PACKER);
}

export function load(room: string, from: number = 0, handler?: MessageHandler): void {
  if (handler) {
    room_watchers.set(room, handler);
  }
  client.load(room, from, ROOM_POST_PACKER);
}

export function watch(room: string, handler?: MessageHandler): void {
  if (handler) {
    room_watchers.set(room, handler);
  }
  client.watch(room, ROOM_POST_PACKER, (message: any) => {
    emit_if_valid(room, message);
  });
}

export function unwatch(room: string): void {
  room_watchers.delete(room);
}

export function close(): void {
  client.close();
}

export function on_sync(callback: () => void): void {
  client.on_sync(callback);
}

// The VibiNet client API only exposes `on_sync`; treat sync as ready/open.
export function on_open(callback: () => void): void {
  client.on_sync(callback);
}

export function ping(): number {
  return client.ping();
}
