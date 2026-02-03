import { WebSocketServer, WebSocket } from "ws";
import type { ClientMessage, ServerMessage, RoomId, PlayerSlot, DummyState } from "./shared.ts";

const PORT = 8080;
const ROOM_SIZE = 2;
const BROADCAST_MS = 1000;

type Room = {
  id: RoomId;
  players: Map<PlayerSlot, WebSocket>;
  tick: number;
};

let room_counter = 1;
const rooms = new Map<RoomId, Room>();
const socket_info = new Map<WebSocket, { room_id: RoomId; slot: PlayerSlot }>();

function now(): number {
  return Math.floor(Date.now());
}

function send(ws: WebSocket, message: ServerMessage): void {
  ws.send(JSON.stringify(message));
}

function broadcast(room: Room, message: ServerMessage): void {
  const payload = JSON.stringify(message);
  for (const ws of room.players.values()) {
    ws.send(payload);
  }
}

function room_players(room: Room): PlayerSlot[] {
  return Array.from(room.players.keys());
}

function create_room(): Room {
  const id = `room-${room_counter++}`;
  const room: Room = { id, players: new Map(), tick: 0 };
  rooms.set(id, room);
  return room;
}

function find_open_room(): Room | null {
  for (const room of rooms.values()) {
    if (room.players.size < ROOM_SIZE) {
      return room;
    }
  }
  return null;
}

function assign_slot(room: Room): PlayerSlot {
  if (!room.players.has("player1")) {
    return "player1";
  }
  if (!room.players.has("player2")) {
    return "player2";
  }
  throw new Error("Room is full");
}

function join_room(ws: WebSocket, requested?: RoomId): void {
  if (socket_info.has(ws)) {
    return;
  }

  let room = requested ? rooms.get(requested) || null : null;
  if (room && room.players.size >= ROOM_SIZE) {
    send(ws, { $: "info_error", message: `Room full: ${room.id}` });
    room = null;
  }

  if (!room) {
    room = find_open_room() ?? create_room();
  }

  const slot = assign_slot(room);
  room.players.set(slot, ws);
  socket_info.set(ws, { room_id: room.id, slot });

  send(ws, { $: "info_join", room: room.id, slot });
  broadcast(room, { $: "info_room", room: room.id, players: room_players(room) });
}

function leave_room(ws: WebSocket): void {
  const info = socket_info.get(ws);
  if (!info) {
    return;
  }

  const room = rooms.get(info.room_id);
  if (room) {
    room.players.delete(info.slot);
    broadcast(room, { $: "info_room", room: room.id, players: room_players(room) });
    if (room.players.size === 0) {
      rooms.delete(room.id);
    }
  }

  socket_info.delete(ws);
}

function parse_message(buffer: WebSocket.RawData): ClientMessage | null {
  try {
    const msg = JSON.parse(buffer.toString());
    if (!msg || typeof msg.$ !== "string") {
      return null;
    }
    return msg as ClientMessage;
  } catch {
    return null;
  }
}

function handle_message(ws: WebSocket, msg: ClientMessage): void {
  switch (msg.$) {
    case "get_time":
      send(ws, { $: "info_time", time: now() });
      return;
    case "join":
      leave_room(ws);
      join_room(ws, msg.room);
      return;
    case "leave":
      leave_room(ws);
      return;
    case "input": {
      const info = socket_info.get(ws);
      if (!info) {
        send(ws, { $: "info_error", message: "Not in a room" });
        return;
      }
      const room = rooms.get(info.room_id);
      if (!room) {
        send(ws, { $: "info_error", message: "Room not found" });
        return;
      }
      broadcast(room, { $: "info_input", room: room.id, slot: info.slot, input: msg.input, seq: msg.seq });
      return;
    }
    case "ping":
      send(ws, { $: "info_pong", time: msg.time });
      return;
  }
}

const wss = new WebSocketServer({ port: PORT });

wss.on("connection", (ws) => {
  join_room(ws);

  ws.on("message", (buffer) => {
    const msg = parse_message(buffer);
    if (!msg) {
      send(ws, { $: "info_error", message: "Invalid message" });
      return;
    }
    handle_message(ws, msg);
  });

  ws.on("close", () => {
    leave_room(ws);
  });
});

setInterval(() => {
  for (const room of rooms.values()) {
    if (room.players.size === 0) {
      continue;
    }
    room.tick += 1;
    const state: DummyState = {
      tick: room.tick,
      players: {
        player1: room.players.has("player1"),
        player2: room.players.has("player2")
      },
      note: "dummy state"
    };
    broadcast(room, { $: "info_state", room: room.id, state });
  }
}, BROADCAST_MS);

console.log(`[WS] Listening on ws://localhost:${PORT}`);
