import { create_client, gen_name } from "vibinet";
import type { RoomPost } from "./shared.ts";
import { is_raw_info_post_envelope, parse_room_post_json } from "./room_post_guards.ts";

export type RoomInfoPostMessage = {
  $: "info_post";
  room: string;
  index: number;
  server_time: number;
  client_time: number;
  name?: string;
  data: RoomPost;
};

type MessageHandler = (message: RoomInfoPostMessage) => void;

const ROOM_POST_PACKER = { $: "String" } as const;
const client = create_client<string>();
const room_watchers = new Map<string, MessageHandler>();

function emit_if_valid(room: string, message: unknown): void {
  if (!is_raw_info_post_envelope(message)) {
    return;
  }
  const data = parse_room_post_json(message.data);
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
    ...(typeof message.name === "string" ? { name: message.name } : {}),
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
  client.watch(room, ROOM_POST_PACKER, (message: unknown) => {
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

export function ping(): number {
  return client.ping();
}
