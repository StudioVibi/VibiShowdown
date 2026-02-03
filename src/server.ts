import { WebSocketServer, WebSocket } from "ws";
import { randomBytes } from "crypto";
import type { ClientMessage, ServerMessage, RoomId, PlayerSlot, DummyState } from "./shared.ts";

const PORT = 8080;
const ROOM_SIZE = 2;
const TURN_MS = 50 * 60 * 1000;
const DEADLINE_CHECK_MS = 1000;

type PlayerRecord = {
  slot: PlayerSlot;
  token: string;
  ws: WebSocket | null;
};

type Room = {
  id: RoomId;
  players: Record<PlayerSlot, PlayerRecord | null>;
  turn: number;
  deadline_at: number;
  intents: Record<PlayerSlot, unknown | null>;
  last_state: DummyState;
  last_log: string[];
};

let room_counter = 1;
const rooms = new Map<RoomId, Room>();
const socket_info = new Map<WebSocket, { room_id: RoomId; slot: PlayerSlot; token: string }>();

function now(): number {
  return Math.floor(Date.now());
}

function gen_token(): string {
  try {
    return randomBytes(12).toString("base64url");
  } catch {
    return Math.random().toString(36).slice(2);
  }
}

function send(ws: WebSocket, message: ServerMessage): void {
  ws.send(JSON.stringify(message));
}

function broadcast(room: Room, message: ServerMessage): void {
  const payload = JSON.stringify(message);
  for (const record of Object.values(room.players)) {
    if (record?.ws) {
      record.ws.send(payload);
    }
  }
}

function room_players(room: Room): PlayerSlot[] {
  const out: PlayerSlot[] = [];
  if (room.players.player1) out.push("player1");
  if (room.players.player2) out.push("player2");
  return out;
}

function room_intents(room: Room): Record<PlayerSlot, boolean> {
  return {
    player1: room.intents.player1 !== null,
    player2: room.intents.player2 !== null
  };
}

function build_state(room: Room, turn: number, note: string): DummyState {
  return {
    turn,
    players: {
      player1: room.players.player1 !== null,
      player2: room.players.player2 !== null
    },
    note
  };
}

function create_room(): Room {
  const id = `room-${room_counter++}`;
  const room: Room = {
    id,
    players: { player1: null, player2: null },
    turn: 0,
    deadline_at: 0,
    intents: { player1: null, player2: null },
    last_state: { turn: 0, players: { player1: false, player2: false }, note: "init" },
    last_log: []
  };
  rooms.set(id, room);
  return room;
}

function has_open_slot(room: Room): boolean {
  return room.players.player1 === null || room.players.player2 === null;
}

function find_open_room(): Room | null {
  for (const room of rooms.values()) {
    if (has_open_slot(room)) {
      return room;
    }
  }
  return null;
}

function assign_slot(room: Room): PlayerSlot {
  if (!room.players.player1) return "player1";
  if (!room.players.player2) return "player2";
  throw new Error("Room is full");
}

function start_turn(room: Room): void {
  room.turn += 1;
  room.deadline_at = now() + TURN_MS;
  room.intents = { player1: null, player2: null };
  broadcast(room, {
    $: "info_turn",
    room: room.id,
    turn: room.turn,
    deadline_at: room.deadline_at,
    intents: room_intents(room)
  });
}

function ensure_turn_started(room: Room): void {
  if (room.deadline_at > 0) {
    return;
  }
  if (room.players.player1 && room.players.player2) {
    start_turn(room);
  }
}

function resolve_turn(room: Room): void {
  const resolved_turn = room.turn;
  const log = [
    `resolved turn ${resolved_turn}`,
    `player1_intent:${room.intents.player1 !== null ? "locked" : "missing"}`,
    `player2_intent:${room.intents.player2 !== null ? "locked" : "missing"}`
  ];

  const state = build_state(room, resolved_turn, "dummy state");
  room.last_state = state;
  room.last_log = log;

  broadcast(room, { $: "info_state", room: room.id, state, log });
  start_turn(room);
}

function intents_complete(room: Room): boolean {
  if (!room.players.player1 || !room.players.player2) {
    return false;
  }
  return room.intents.player1 !== null && room.intents.player2 !== null;
}

function end_match(room: Room, losers: PlayerSlot[]): void {
  let winner: PlayerSlot | undefined;
  if (losers.length === 1) {
    winner = losers[0] === "player1" ? "player2" : "player1";
  }

  broadcast(room, {
    $: "info_forfeit",
    room: room.id,
    turn: room.turn,
    losers,
    winner
  });

  for (const record of Object.values(room.players)) {
    if (record?.ws) {
      socket_info.delete(record.ws);
    }
  }

  rooms.delete(room.id);
}

function attach(ws: WebSocket, room: Room, slot: PlayerSlot, token: string, reconnect: boolean): void {
  const record: PlayerRecord = room.players[slot] ?? { slot, token, ws: null };
  record.ws = ws;
  room.players[slot] = record;
  socket_info.set(ws, { room_id: room.id, slot, token });

  send(ws, { $: "info_join", room: room.id, slot, token, reconnect });
  send(ws, { $: "info_state", room: room.id, state: room.last_state, log: room.last_log });

  if (room.deadline_at > 0) {
    send(ws, {
      $: "info_turn",
      room: room.id,
      turn: room.turn,
      deadline_at: room.deadline_at,
      intents: room_intents(room)
    });
  }

  if (!reconnect) {
    broadcast(room, { $: "info_room", room: room.id, players: room_players(room) });
  }

  ensure_turn_started(room);
}

function find_by_token(token: string): { room: Room; slot: PlayerSlot } | null {
  for (const room of rooms.values()) {
    for (const slot of ["player1", "player2"] as const) {
      const record = room.players[slot];
      if (record && record.token === token) {
        return { room, slot };
      }
    }
  }
  return null;
}

function join_room(ws: WebSocket, requested?: RoomId, token?: string): void {
  if (token) {
    const match = find_by_token(token);
    if (!match) {
      send(ws, { $: "info_error", message: "Invalid token" });
      return;
    }
    attach(ws, match.room, match.slot, token, true);
    return;
  }

  let room = requested ? rooms.get(requested) || null : null;
  if (room && !has_open_slot(room)) {
    send(ws, { $: "info_error", message: `Room full: ${room.id}` });
    room = null;
  }

  if (!room) {
    room = find_open_room() ?? create_room();
  }

  const slot = assign_slot(room);
  const new_token = gen_token();
  attach(ws, room, slot, new_token, false);
}

function detach_socket(ws: WebSocket): void {
  const info = socket_info.get(ws);
  if (!info) {
    return;
  }

  const room = rooms.get(info.room_id);
  if (room) {
    const record = room.players[info.slot];
    if (record && record.token === info.token) {
      record.ws = null;
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
      detach_socket(ws);
      join_room(ws, msg.room, msg.token);
      return;
    case "leave":
      detach_socket(ws);
      return;
    case "submit_intent": {
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
      if (room.deadline_at === 0) {
        send(ws, { $: "info_error", message: "Turn not active" });
        return;
      }
      if (msg.turn !== undefined && msg.turn !== room.turn) {
        send(ws, { $: "info_error", message: `Wrong turn: ${msg.turn}` });
        return;
      }
      if (room.intents[info.slot] !== null) {
        send(ws, { $: "info_error", message: "Intent already locked" });
        return;
      }

      room.intents[info.slot] = msg.intent;
      broadcast(room, { $: "info_intent_locked", room: room.id, slot: info.slot, turn: room.turn });
      broadcast(room, {
        $: "info_turn",
        room: room.id,
        turn: room.turn,
        deadline_at: room.deadline_at,
        intents: room_intents(room)
      });

      if (intents_complete(room)) {
        resolve_turn(room);
      }
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
    detach_socket(ws);
  });
});

setInterval(() => {
  const t = now();
  for (const room of rooms.values()) {
    if (room.deadline_at === 0) {
      continue;
    }
    if (t < room.deadline_at) {
      continue;
    }
    const losers: PlayerSlot[] = [];
    if (room.players.player1 && room.intents.player1 === null) {
      losers.push("player1");
    }
    if (room.players.player2 && room.intents.player2 === null) {
      losers.push("player2");
    }
    if (losers.length > 0) {
      end_match(room, losers);
    }
  }
}, DEADLINE_CHECK_MS);

console.log(`[WS] Listening on ws://localhost:${PORT}`);
