import { WebSocketServer, WebSocket } from "ws";
import { appendFileSync, readFileSync, existsSync, mkdirSync } from "fs";
import http from "http";
import { readFile } from "fs/promises";
import {
  create_initial_state,
  resolve_turn,
  validate_intent,
  clone_state
} from "./engine.ts";
import type {
  ClientMessage,
  EventLog,
  GameState,
  PlayerIntent,
  PlayerSlot,
  RoomId,
  RoomPost,
  ServerMessage,
  TeamSelection
} from "./shared.ts";

declare const Bun: any;

const PORT = 8080;
const TURN_MS = 50 * 60 * 1000;
const DEADLINE_CHECK_MS = 1000;

type PlayerRecord = {
  slot: PlayerSlot;
  token: string;
  name: string;
  ws: WebSocket | null;
};

type RoomState = {
  id: RoomId;
  players: Record<PlayerSlot, PlayerRecord | null>;
  ready: Record<PlayerSlot, boolean>;
  teams: Record<PlayerSlot, TeamSelection | null>;
  state: GameState | null;
  turn: number;
  deadline_at: number;
  intents: Record<PlayerSlot, PlayerIntent | null>;
  last_state: GameState | null;
  last_log: EventLog[];
  ended: boolean;
};

const rooms = new Map<RoomId, RoomState>();
const watchers = new Map<RoomId, Set<WebSocket>>();
const socket_info = new Map<WebSocket, { room: RoomId; slot: PlayerSlot; token: string }>();
const token_index = new Map<string, { room: RoomId; slot: PlayerSlot }>();

function now(): number {
  return Math.floor(Date.now());
}

function gen_token(): string {
  const alphabet = "abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789";
  let out = "";
  for (let i = 0; i < 20; i++) {
    out += alphabet[Math.floor(Math.random() * alphabet.length)];
  }
  return out;
}

function ensure_room(room_id: RoomId): RoomState {
  const existing = rooms.get(room_id);
  if (existing) {
    return existing;
  }
  const room: RoomState = {
    id: room_id,
    players: { player1: null, player2: null },
    ready: { player1: false, player2: false },
    teams: { player1: null, player2: null },
    state: null,
    turn: 0,
    deadline_at: 0,
    intents: { player1: null, player2: null },
    last_state: null,
    last_log: [],
    ended: false
  };
  rooms.set(room_id, room);
  return room;
}

function has_open_slot(room: RoomState): boolean {
  return room.players.player1 === null || room.players.player2 === null;
}

function assign_slot(room: RoomState): PlayerSlot {
  if (!room.players.player1) return "player1";
  if (!room.players.player2) return "player2";
  throw new Error("Room full");
}

function room_intents(room: RoomState): Record<PlayerSlot, boolean> {
  return {
    player1: room.intents.player1 !== null,
    player2: room.intents.player2 !== null
  };
}

function send(ws: WebSocket, message: ServerMessage): void {
  ws.send(JSON.stringify(message));
}

function broadcast(room_id: RoomId, message: ServerMessage): void {
  const set = watchers.get(room_id);
  if (!set) {
    return;
  }
  const payload = JSON.stringify(message);
  for (const ws of set) {
    ws.send(payload);
  }
}

function ensure_db(): void {
  if (!existsSync("./db")) {
    mkdirSync("./db");
  }
}

function next_index(path: string): number {
  if (!existsSync(path)) {
    return 0;
  }
  const content = readFileSync(path, "utf-8");
  const lines = content.trim().split("\n").filter((l) => l.trim());
  return lines.length;
}

function persist_post(room: RoomId, client_time: number, name: string | undefined, data: RoomPost): number {
  ensure_db();
  const path = `./db/${room}.jsonl`;
  const index = next_index(path);
  const server_time = now();
  const file_line = JSON.stringify({ server_time, client_time, name, data });
  appendFileSync(path, file_line + "\n");
  return index;
}

function emit_post(room: RoomId, data: RoomPost, name: string = "server", client_time?: number): void {
  const ct = client_time ?? now();
  const index = persist_post(room, ct, name, data);
  const server_time = now();
  broadcast(room, { $: "info_post", room, index, server_time, client_time: ct, name, data });
}

function send_direct(ws: WebSocket, room: RoomId, data: RoomPost, name: string = "server"): void {
  const ts = now();
  send(ws, { $: "info_post", room, index: -1, server_time: ts, client_time: ts, name, data });
}

function send_error(ws: WebSocket, room: RoomId, message: string, code?: string): void {
  send_direct(ws, room, { $: "error", message, code });
}

function emit_ready_state(room: RoomState): void {
  emit_post(room.id, {
    $: "ready_state",
    ready: { ...room.ready },
    names: {
      player1: room.players.player1?.name ?? null,
      player2: room.players.player2?.name ?? null
    }
  });
}

function start_turn(room: RoomState): void {
  room.turn += 1;
  room.deadline_at = now() + TURN_MS;
  room.intents = { player1: null, player2: null };
  if (room.state) {
    room.state.turn = room.turn;
    room.state.status = "running";
  }
  emit_post(room.id, {
    $: "turn_start",
    turn: room.turn,
    deadline_at: room.deadline_at,
    intents: room_intents(room)
  });
}

function start_match(room: RoomState): void {
  if (room.ended || room.state) {
    return;
  }
  if (!room.teams.player1 || !room.teams.player2) {
    return;
  }
  const names = {
    player1: room.players.player1?.name || "player1",
    player2: room.players.player2?.name || "player2"
  };
  const state = create_initial_state(
    {
      player1: room.teams.player1,
      player2: room.teams.player2
    },
    names
  );
  state.status = "running";
  room.state = state;
  room.last_state = clone_state(state);
  room.last_log = [];
  emit_post(room.id, { $: "state", turn: 0, state, log: [] });
  start_turn(room);
}

function validate_team(team: TeamSelection): string | null {
  if (!team || !Array.isArray(team.monsters)) {
    return "Invalid team";
  }
  if (team.monsters.length !== 3) {
    return "Team must have 3 monsters";
  }
  if (team.activeIndex < 0 || team.activeIndex >= team.monsters.length) {
    return "Active index invalid";
  }
  for (const monster of team.monsters) {
    if (!monster.id) {
      return "Monster missing id";
    }
    if (!Array.isArray(monster.moves) || monster.moves.length !== 4) {
      return "Monster must have 4 moves";
    }
    const dedup = new Set<string>();
    for (const move of monster.moves) {
      if (move !== "none") {
        if (dedup.has(move)) {
          return "Duplicate moves are not allowed";
        }
        dedup.add(move);
      }
    }
    const stats = monster.stats;
    if (!stats) {
      return "Stats missing";
    }
    if (stats.maxHp <= 0 || stats.attack < 0 || stats.defense < 0 || stats.speed < 0) {
      return "Invalid stats";
    }
  }
  return null;
}

function handle_join(ws: WebSocket, room_id: RoomId, data: RoomPost): void {
  if (data.$ !== "join") {
    return;
  }

  const room = ensure_room(room_id);
  if (room.ended) {
    send_error(ws, room_id, "Match already ended");
    return;
  }

  if (data.token) {
    const lookup = token_index.get(data.token);
    if (!lookup || lookup.room !== room_id) {
      send_error(ws, room_id, "Invalid token");
      return;
    }
    const record = room.players[lookup.slot];
    if (!record || record.token !== data.token) {
      send_error(ws, room_id, "Token mismatch");
      return;
    }
    record.ws = ws;
    socket_info.set(ws, { room: room_id, slot: record.slot, token: record.token });
    send_direct(ws, room_id, { $: "assign", slot: record.slot, token: record.token, name: record.name });
    if (room.last_state) {
      send_direct(ws, room_id, { $: "state", turn: room.last_state.turn, state: room.last_state, log: room.last_log });
    }
    if (room.deadline_at > 0) {
      send_direct(ws, room_id, {
        $: "turn_start",
        turn: room.turn,
        deadline_at: room.deadline_at,
        intents: room_intents(room)
      });
    }
    send_direct(ws, room_id, {
      $: "ready_state",
      ready: { ...room.ready },
      names: {
        player1: room.players.player1?.name ?? null,
        player2: room.players.player2?.name ?? null
      }
    });
    return;
  }

  if (!has_open_slot(room)) {
    send_error(ws, room_id, "Room is full");
    return;
  }

  const slot = assign_slot(room);
  const token = gen_token();
  const record: PlayerRecord = { slot, token, name: data.name, ws };
  room.players[slot] = record;
  token_index.set(token, { room: room_id, slot });
  socket_info.set(ws, { room: room_id, slot, token });
  send_direct(ws, room_id, { $: "assign", slot, token, name: data.name });
  emit_ready_state(room);
}

function handle_ready(ws: WebSocket, room_id: RoomId, data: RoomPost): void {
  if (data.$ !== "ready") return;

  const info = socket_info.get(ws);
  if (!info || info.room !== room_id) {
    send_error(ws, room_id, "Not assigned to this room");
    return;
  }
  const room = rooms.get(room_id);
  if (!room || room.ended) {
    send_error(ws, room_id, "Room not found");
    return;
  }
  if (room.turn > 0) {
    send_error(ws, room_id, "Match already started");
    return;
  }

  if (!data.ready) {
    room.ready[info.slot] = false;
    emit_ready_state(room);
    emit_post(room_id, { $: "ready", ready: false });
    return;
  }

  if (!data.team) {
    send_error(ws, room_id, "Missing team");
    return;
  }
  const validation = validate_team(data.team);
  if (validation) {
    send_error(ws, room_id, validation, "invalid_team");
    return;
  }

  room.teams[info.slot] = data.team;
  room.ready[info.slot] = true;
  emit_post(room_id, { $: "ready", ready: true, team: data.team });
  emit_ready_state(room);

  if (room.ready.player1 && room.ready.player2) {
    start_match(room);
  }
}

function handle_intent(ws: WebSocket, room_id: RoomId, data: RoomPost): void {
  if (data.$ !== "intent") return;

  const info = socket_info.get(ws);
  if (!info || info.room !== room_id) {
    send_error(ws, room_id, "Not assigned to this room");
    return;
  }

  const room = rooms.get(room_id);
  if (!room || room.ended || !room.state) {
    send_error(ws, room_id, "Room not found");
    return;
  }

  if (room.deadline_at === 0) {
    send_error(ws, room_id, "Turn not active");
    return;
  }

  if (now() >= room.deadline_at) {
    send_error(ws, room_id, "Turn deadline passed");
    return;
  }

  if (data.turn !== room.turn) {
    send_error(ws, room_id, `Wrong turn ${data.turn}`);
    return;
  }

  if (room.intents[info.slot] !== null) {
    send_error(ws, room_id, "Intent already locked");
    return;
  }

  const validation = validate_intent(room.state, info.slot, data.intent);
  if (validation) {
    send_error(ws, room_id, validation, "invalid_intent");
    return;
  }

  room.intents[info.slot] = data.intent;
  emit_post(room_id, data);
  emit_post(room_id, { $: "intent_locked", slot: info.slot, turn: room.turn });

  if (room.intents.player1 && room.intents.player2) {
    const { state, log } = resolve_turn(room.state, room.intents);
    room.state = state;
    room.last_state = clone_state(state);
    room.last_log = log;
    emit_post(room.id, { $: "state", turn: room.turn, state, log });
    if (state.status === "ended") {
      room.ended = true;
      room.deadline_at = 0;
      return;
    }
    start_turn(room);
  }
}

function handle_post_message(ws: WebSocket, message: ClientMessage): void {
  if (message.$ !== "post") return;
  const { room, time: client_time, name, data } = message;

  if (data.$ === "join") {
    handle_join(ws, room, data);
    const safe_data: RoomPost = { $: "join", name: data.name };
    emit_post(room, safe_data, name, client_time);
    return;
  }

  if (data.$ === "ready") {
    handle_ready(ws, room, data);
    return;
  }

  if (data.$ === "intent") {
    handle_intent(ws, room, data);
    return;
  }

  emit_post(room, data, name, client_time);
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

async function build_walkers(): Promise<void> {
  try {
    const r1 = Bun.spawnSync({
      cmd: ["bun", "build", "walkers/index.ts", "--outdir", "walkers/dist", "--target=browser", "--format=esm"]
    });
    if (!r1.success) {
      console.error("[BUILD] walkers build failed", { r1: r1.success });
    } else {
      console.log("[BUILD] walkers bundle ready");
    }
  } catch (e) {
    console.error("[BUILD] error while building walkers:", e);
  }
}

await build_walkers();

const server = http.createServer(async (req, res) => {
  try {
    const url = new URL(req.url || "/", `http://${req.headers.host}`);
    let path = url.pathname;
    if (path === "/") path = "/index.html";

    let filesystem_path: string;
    if (path.startsWith("/icons/")) {
      filesystem_path = path.slice(1);
    } else {
      filesystem_path = path.startsWith("/dist/") ? `walkers${path}` : `walkers${path}`;
    }

    let ct = "application/octet-stream";
    if (path.endsWith(".html")) {
      ct = "text/html";
    } else if (path.endsWith(".js")) {
      ct = "application/javascript";
    } else if (path.endsWith(".css")) {
      ct = "text/css";
    } else if (path.endsWith(".map")) {
      ct = "application/json";
    } else if (path.endsWith(".png")) {
      ct = "image/png";
    }

    const data = await readFile(filesystem_path);
    res.writeHead(200, { "Content-Type": ct });
    res.end(data);
  } catch {
    res.writeHead(404, { "Content-Type": "text/plain" });
    res.end("Not Found");
  }
});

const wss = new WebSocketServer({ server });

wss.on("connection", (ws) => {
  ws.on("message", (buffer) => {
    const msg = parse_message(buffer);
    if (!msg) {
      send(ws, {
        $: "info_post",
        room: "unknown",
        index: -1,
        server_time: now(),
        client_time: now(),
        data: { $: "error", message: "Invalid message" }
      });
      return;
    }

    switch (msg.$) {
      case "get_time":
        send(ws, { $: "info_time", time: now() });
        break;
      case "post":
        handle_post_message(ws, msg);
        break;
      case "load":
        handle_load(ws, msg.room, msg.from ?? 0);
        break;
      case "watch":
        handle_watch(ws, msg.room);
        break;
      case "unwatch":
        handle_unwatch(ws, msg.room);
        break;
    }
  });

  ws.on("close", () => {
    detach_socket(ws);
  });
});

function handle_watch(ws: WebSocket, room: RoomId): void {
  if (!watchers.has(room)) {
    watchers.set(room, new Set());
  }
  watchers.get(room)!.add(ws);
}

function handle_unwatch(ws: WebSocket, room: RoomId): void {
  const set = watchers.get(room);
  if (!set) return;
  set.delete(ws);
  if (set.size === 0) {
    watchers.delete(room);
  }
}

function detach_socket(ws: WebSocket): void {
  const info = socket_info.get(ws);
  if (info) {
    const room = rooms.get(info.room);
    if (room) {
      const record = room.players[info.slot];
      if (record && record.token === info.token) {
        record.ws = null;
      }
    }
    socket_info.delete(ws);
  }

  for (const set of watchers.values()) {
    set.delete(ws);
  }
}

function handle_load(ws: WebSocket, room: RoomId, from: number): void {
  const path = `./db/${room}.jsonl`;
  if (!existsSync(path)) {
    return;
  }
  const content = readFileSync(path, "utf-8");
  const lines = content.trim().split("\n");
  for (let index = Math.max(0, from); index < lines.length; index++) {
    const line = lines[index];
    if (!line || !line.trim()) continue;
    const record = JSON.parse(line);
    const server_time = record.server_time;
    const client_time = record.client_time;
    const name = record.name;
    const data = record.data as RoomPost;
    send(ws, { $: "info_post", room, index, server_time, client_time, name, data });
  }
}

setInterval(() => {
  const t = now();
  for (const room of rooms.values()) {
    if (room.ended || room.deadline_at === 0) {
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
      room.ended = true;
      room.deadline_at = 0;
      let winner: PlayerSlot | undefined;
      if (losers.length === 1) {
        winner = losers[0] === "player1" ? "player2" : "player1";
      }
      if (room.state) {
        room.state.status = "ended";
        room.state.winner = winner;
        room.last_state = clone_state(room.state);
      }
      emit_post(room.id, { $: "forfeit", turn: room.turn, losers, winner });
    }
  }
}, DEADLINE_CHECK_MS);

server.listen(PORT, () => {
  console.log(`Server running at http://localhost:${PORT} (HTTP + WebSocket)`);
});
