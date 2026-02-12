import { gen_name, load, on_sync, ping, post, watch } from "../src/client.ts";
import {
  MONSTER_BY_ID as roster_by_id,
  MONSTER_ROSTER as roster,
  MOVE_LABELS,
  PASSIVE_LABELS,
  normalize_passive_id
} from "../src/game_default/index.ts";
import type { MonsterCatalogEntry } from "../src/game_default/index.ts";
import { apply_forced_switch, create_initial_state, resolve_turn, validate_intent } from "../src/engine.ts";
import type {
  EVSpread,
  EventLog,
  GameState,
  MonsterState,
  PlayerIntent,
  PlayerSlot,
  RoomPost,
  Stats,
  TeamSelection
} from "../src/shared.ts";
import { normalize_int } from "../src/int_math.ts";
import {
  EV_PER_STAT_MAX,
  EV_TOTAL_MAX,
  LEVEL_MAX,
  LEVEL_MIN,
  calc_final_stats,
  empty_ev_spread,
  validate_ev_spread
} from "../src/stats_calc.ts";

type MonsterConfig = {
  moves: string[];
  passive: string;
  stats: Stats;
  ev: EVSpread;
};

type Profile = {
  monsters: Record<string, MonsterConfig>;
};

type EVStatKey = keyof EVSpread;
const EV_KEYS: EVStatKey[] = ["hp", "atk", "def", "spe"];

type TooltipValueState = "up" | "down" | "neutral";

type MonsterTooltipPayload = {
  id: string;
  name: string;
  passive: string;
  moves: string[];
  current: { hp: number; maxHp: number; attack: number; defense: number; speed: number };
  base: { maxHp: number; attack: number; defense: number; speed: number };
};

const PLAYER_SLOTS: PlayerSlot[] = ["player1", "player2"];

const LAST_ROOM_KEY = "vibi_showdown_last_room";
const LAST_PLAYER_NAME_KEY = "vibi_showdown_last_player_name";

function normalize_identity_value(value: string | null | undefined): string | null {
  if (typeof value !== "string") {
    return null;
  }
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : null;
}

function read_saved_identity_value(key: string): string | null {
  try {
    return normalize_identity_value(localStorage.getItem(key));
  } catch {
    return null;
  }
}

function save_identity_value(key: string, value: string): void {
  try {
    localStorage.setItem(key, value);
  } catch {}
}

function prompt_identity(label: string, fallback: string): string {
  const next = normalize_identity_value(prompt(label, fallback));
  return next ?? fallback;
}

function resolve_session_identity(): { room: string; player_name: string } {
  const params = new URLSearchParams(window.location.search);
  const room_param = normalize_identity_value(params.get("room"));
  const name_param = normalize_identity_value(params.get("name"));

  const default_room = room_param ?? read_saved_identity_value(LAST_ROOM_KEY) ?? gen_name();
  const default_name = name_param ?? read_saved_identity_value(LAST_PLAYER_NAME_KEY) ?? gen_name();
  const resolved_room = prompt_identity("Room name?", default_room);
  const resolved_name = prompt_identity("Your name?", default_name);

  save_identity_value(LAST_ROOM_KEY, resolved_room);
  save_identity_value(LAST_PLAYER_NAME_KEY, resolved_name);

  return { room: resolved_room, player_name: resolved_name };
}

const { room, player_name } = resolve_session_identity();

function stable_player_id_from_name(name: string): string {
  const normalized = name.trim().toLowerCase().replace(/\s+/g, " ");
  return `name:${encodeURIComponent(normalized)}`;
}

const player_id = stable_player_id_from_name(player_name);

const profile_key = `vibi_showdown_profile:${player_name}`;
const team_key = `vibi_showdown_team:${room}:${player_name}`;

const status_room = document.getElementById("status-room")!;
const status_name = document.getElementById("status-name")!;
const status_slot = document.getElementById("status-slot");
const status_conn = document.getElementById("status-conn");
const status_ping = document.getElementById("status-ping")!;
const status_turn = document.getElementById("status-turn")!;
const status_deadline = document.getElementById("status-deadline")!;
const status_ready = document.getElementById("status-ready");
const status_opponent = document.getElementById("status-opponent");
const chat_messages = document.getElementById("chat-messages")!;
const log_list = (document.getElementById("log-list") as HTMLElement | null) ?? chat_messages;
const chat_input = document.getElementById("chat-input") as HTMLInputElement | null;
const chat_send = document.getElementById("chat-send") as HTMLButtonElement | null;
const participants_list = document.getElementById("participants-list")!;
const stat_tooltip = document.getElementById("stat-tooltip") as HTMLDivElement | null;

const player_title = document.getElementById("player-name")!;
const player_meta = document.getElementById("player-meta")!;
const enemy_title = document.getElementById("enemy-name")!;
const enemy_meta = document.getElementById("enemy-meta")!;
const enemy_hp = document.getElementById("enemy-hp")!;
const player_hp = document.getElementById("player-hp")!;
const player_sprite = document.getElementById("player-sprite") as HTMLImageElement;
const enemy_sprite = document.getElementById("enemy-sprite") as HTMLImageElement;
const player_sprite_wrap = document.getElementById("player-sprite-wrap") as HTMLDivElement;
const enemy_sprite_wrap = document.getElementById("enemy-sprite-wrap") as HTMLDivElement;
const player_effects = document.getElementById("player-effects") as HTMLDivElement | null;
const enemy_effects = document.getElementById("enemy-effects") as HTMLDivElement | null;

const prematch = document.getElementById("prematch")!;
const prematch_hint = document.getElementById("prematch-hint")!;
const ready_btn = document.getElementById("ready-btn") as HTMLButtonElement;
const reset_status_btn = document.getElementById("reset-status-btn") as HTMLButtonElement | null;
const move_buttons = [
  document.getElementById("move-btn-0") as HTMLButtonElement,
  document.getElementById("move-btn-1") as HTMLButtonElement,
  document.getElementById("move-btn-2") as HTMLButtonElement,
  document.getElementById("move-btn-3") as HTMLButtonElement
];
const switch_btn = document.getElementById("switch-btn") as HTMLButtonElement | null;
const surrender_btn = document.getElementById("surrender-btn") as HTMLButtonElement;
const switch_modal = document.getElementById("switch-modal") as HTMLDivElement;
const switch_options = document.getElementById("switch-options") as HTMLDivElement;
const switch_close = document.getElementById("switch-close") as HTMLButtonElement;

const roster_count = document.getElementById("roster-count")!;
const slot_active = document.getElementById("slot-active") as HTMLButtonElement;
const slot_bench_a = document.getElementById("slot-bench-a") as HTMLButtonElement;
const slot_bench_b = document.getElementById("slot-bench-b") as HTMLButtonElement;
const slot_active_name = document.getElementById("slot-active-name")!;
const slot_bench_a_name = document.getElementById("slot-bench-a-name")!;
const slot_bench_b_name = document.getElementById("slot-bench-b-name")!;
const slot_active_img = document.getElementById("slot-active-img") as HTMLImageElement;
const slot_bench_a_img = document.getElementById("slot-bench-a-img") as HTMLImageElement;
const slot_bench_b_img = document.getElementById("slot-bench-b-img") as HTMLImageElement;
const monster_tabs = document.getElementById("monster-tabs");
const moves_grid = document.getElementById("moves-grid")!;
const stats_grid = document.getElementById("stats-grid")!;
const config_warning = document.getElementById("config-warning")!;
const player_bench_slots = [
  {
    btn: document.getElementById("player-bench-0") as HTMLButtonElement,
    img: document.getElementById("player-bench-0-img") as HTMLImageElement
  },
  {
    btn: document.getElementById("player-bench-1") as HTMLButtonElement,
    img: document.getElementById("player-bench-1-img") as HTMLImageElement
  }
];
const enemy_bench_slots = [
  {
    btn: document.getElementById("enemy-bench-0") as HTMLButtonElement,
    img: document.getElementById("enemy-bench-0-img") as HTMLImageElement
  },
  {
    btn: document.getElementById("enemy-bench-1") as HTMLButtonElement,
    img: document.getElementById("enemy-bench-1-img") as HTMLImageElement
  }
];

const match_end = document.getElementById("match-end") as HTMLDivElement;
const match_end_title = document.getElementById("match-end-title") as HTMLDivElement;
const match_end_sub = document.getElementById("match-end-sub") as HTMLDivElement;
const match_end_btn = document.getElementById("match-end-btn") as HTMLButtonElement;

status_room.textContent = room;
status_name.textContent = player_name;
player_title.textContent = player_name;
enemy_title.textContent = "Opponent";
document.body.classList.add("prematch-open");

let current_turn = 0;
let deadline_at = 0;
let slot: PlayerSlot | null = null;
let is_ready = false;
let match_started = false;
let latest_state: GameState | null = null;
let opponent_ready = false;
let opponent_name: string | null = null;
let is_spectator = false;
let last_ready_snapshot: Record<PlayerSlot, boolean> | null = null;
let participants: { players: Record<PlayerSlot, string | null>; spectators: string[] } | null = null;
let ready_order: PlayerSlot[] = [];
let selected_intent: PlayerIntent | null = null;
let selected_intent_turn = 0;
const hp_animation: { player?: number; enemy?: number } = {};
const animation_timers: number[] = [];
const sprite_fx_classes = ["jump", "hit", "heal", "shield-on", "shield-hit"];

const selected: string[] = [];
let active_tab: string | null = null;
const tooltip_payload_by_element = new WeakMap<HTMLElement, MonsterTooltipPayload>();
let active_tooltip_target: HTMLElement | null = null;

let relay_server_managed = false;
let relay_ended = false;
let relay_turn = 0;
let relay_state: GameState | null = null;
let relay_local_role: PlayerSlot | "spectator" | null = null;
const RELAY_WATCHER_TTL_MS = 90_000;
const RELAY_JOIN_HEARTBEAT_MS = 25_000;
const relay_seen_indexes = new Set<number>();
const relay_names_by_id = new Map<string, string>();
const relay_last_seen_at = new Map<string, number>();
const relay_slot_by_id = new Map<string, PlayerSlot>();
const relay_ids_by_slot: Record<PlayerSlot, string | null> = { player1: null, player2: null };
const relay_join_order: string[] = [];
const relay_ready_order_ids: string[] = [];
const relay_team_by_id = new Map<string, TeamSelection>();
const relay_intents: Record<PlayerSlot, PlayerIntent | null> = { player1: null, player2: null };
const relay_forced_switch_intents: Record<PlayerSlot, number | null> = { player1: null, player2: null };
let join_sent = false;
let room_feed_started = false;
let chat_ready = false;

let forced_switch_target_index: number | null = null;
let forced_switch_target_turn = 0;
let room_game_count = 0;

function icon_path(id: string): string {
  return `./icons/unit_${id}.png`;
}

function emit_local_post(data: RoomPost): void {
  handle_post({ data });
}

function is_server_managed_post(data: RoomPost): boolean {
  return (
    data.$ === "assign" ||
    data.$ === "spectator" ||
    data.$ === "participants" ||
    data.$ === "ready_state" ||
    data.$ === "turn_start" ||
    data.$ === "state" ||
    data.$ === "intent_locked"
  );
}

function legacy_player_id(name: string): string {
  return `legacy:${name}`;
}

function relay_identity(data: RoomPost): string | null {
  const candidate = (data as { player_id?: unknown }).player_id;
  if (typeof candidate === "string" && candidate.length > 0) {
    return candidate;
  }
  if (data.$ === "join") {
    return legacy_player_id(data.name);
  }
  if (data.$ === "chat") {
    return legacy_player_id(data.from);
  }
  return null;
}

function relay_name(id: string): string {
  return relay_names_by_id.get(id) ?? id;
}

function relay_names_by_slot(): Record<PlayerSlot, string | null> {
  const p1 = relay_ids_by_slot.player1;
  const p2 = relay_ids_by_slot.player2;
  return {
    player1: p1 ? relay_name(p1) : null,
    player2: p2 ? relay_name(p2) : null
  };
}

function relay_spectator_names(): string[] {
  return relay_join_order.filter((id) => !relay_slot_by_id.has(id)).map(relay_name);
}

function relay_emit_snapshots(): void {
  const names = relay_names_by_slot();
  const ready: Record<PlayerSlot, boolean> = {
    player1: !!relay_ids_by_slot.player1,
    player2: !!relay_ids_by_slot.player2
  };
  const order: PlayerSlot[] = [];
  if (ready.player1) {
    order.push("player1");
  }
  if (ready.player2) {
    order.push("player2");
  }
  emit_local_post({
    $: "ready_state",
    ready,
    names,
    order
  });
  emit_local_post({
    $: "participants",
    players: names,
    spectators: relay_spectator_names()
  });
}

function relay_emit_local_role(): void {
  const local_slot = relay_slot_by_id.get(player_id);
  if (local_slot) {
    if (relay_local_role === local_slot) {
      return;
    }
    relay_local_role = local_slot;
    emit_local_post({ $: "assign", slot: local_slot, token: player_id, name: relay_name(player_id) });
    return;
  }
  if (relay_join_order.includes(player_id)) {
    if (relay_local_role === "spectator") {
      return;
    }
    relay_local_role = "spectator";
    emit_local_post({ $: "spectator", name: relay_name(player_id) });
    return;
  }
  relay_local_role = null;
}

function relay_recompute_slots_from_ready_order(): void {
  relay_slot_by_id.clear();
  const p1 = relay_ready_order_ids[0] ?? null;
  const p2 = relay_ready_order_ids[1] ?? null;
  relay_ids_by_slot.player1 = p1;
  relay_ids_by_slot.player2 = p2;
  if (p1) {
    relay_slot_by_id.set(p1, "player1");
  }
  if (p2) {
    relay_slot_by_id.set(p2, "player2");
  }
}

function relay_reset_match_to_lobby(): void {
  relay_state = null;
  relay_ended = false;
  relay_turn = 0;
  relay_intents.player1 = null;
  relay_intents.player2 = null;
  relay_forced_switch_intents.player1 = null;
  relay_forced_switch_intents.player2 = null;
  relay_team_by_id.clear();
  relay_ready_order_ids.length = 0;
  relay_recompute_slots_from_ready_order();
  relay_emit_local_role();
  relay_emit_snapshots();
}

function relay_remove_participant(id: string): void {
  const join_idx = relay_join_order.indexOf(id);
  if (join_idx >= 0) {
    relay_join_order.splice(join_idx, 1);
  }
  relay_last_seen_at.delete(id);
  relay_names_by_id.delete(id);

  relay_team_by_id.delete(id);
  const ready_idx = relay_ready_order_ids.indexOf(id);
  if (ready_idx >= 0) {
    relay_ready_order_ids.splice(ready_idx, 1);
  }
  relay_recompute_slots_from_ready_order();
  relay_intents.player1 = null;
  relay_intents.player2 = null;
  relay_forced_switch_intents.player1 = null;
  relay_forced_switch_intents.player2 = null;
}

function relay_prune_inactive(now_ms: number): void {
  let changed = false;
  for (let i = relay_join_order.length - 1; i >= 0; i--) {
    const id = relay_join_order[i];
    const seen_at = relay_last_seen_at.get(id);
    if (typeof seen_at !== "number") {
      relay_remove_participant(id);
      changed = true;
      continue;
    }
    if (now_ms - seen_at <= RELAY_WATCHER_TTL_MS) {
      continue;
    }
    const slot_id = relay_slot_by_id.get(id);
    if (slot_id && relay_state?.status === "running") {
      continue;
    }
    relay_remove_participant(id);
    changed = true;
  }
  if (!changed) {
    return;
  }
  relay_emit_local_role();
  relay_emit_snapshots();
}

function relay_start_turn(): void {
  if (!relay_state || relay_ended) {
    return;
  }
  relay_turn += 1;
  relay_state.turn = relay_turn;
  relay_intents.player1 = null;
  relay_intents.player2 = null;
  relay_forced_switch_intents.player1 = null;
  relay_forced_switch_intents.player2 = null;
  emit_local_post({
    $: "turn_start",
    turn: relay_turn,
    deadline_at: 0,
    intents: { player1: false, player2: false }
  });
}

function relay_start_match_if_ready(): void {
  if (relay_state || relay_ended) {
    return;
  }
  const p1 = relay_ids_by_slot.player1;
  const p2 = relay_ids_by_slot.player2;
  if (!p1 || !p2) {
    return;
  }
  const p1_team = relay_team_by_id.get(p1);
  const p2_team = relay_team_by_id.get(p2);
  if (!p1_team || !p2_team) {
    return;
  }
  const names = relay_names_by_slot();
  try {
    relay_state = create_initial_state(
      {
        player1: p1_team,
        player2: p2_team
      },
      {
        player1: names.player1 || "player1",
        player2: names.player2 || "player2"
      }
    );
  } catch (error) {
    const message = error instanceof Error ? error.message : "invalid team";
    append_chat(`team error: ${message}`);
    return;
  }
  relay_state.status = "running";
  relay_turn = 0;
  emit_local_post({ $: "state", turn: 0, state: relay_state, log: [] });
  relay_start_turn();
}

function relay_handle_join(data: Extract<RoomPost, { $: "join" }>): void {
  const id = relay_identity(data);
  if (!id) {
    return;
  }
  const is_first_join = !relay_join_order.includes(id);
  relay_names_by_id.set(id, data.name);
  if (is_first_join) {
    relay_join_order.push(id);
    emit_local_post({ $: "join", name: data.name });
  }
  relay_emit_local_role();
  relay_emit_snapshots();
}

function relay_handle_ready(data: Extract<RoomPost, { $: "ready" }>): void {
  if (relay_state?.status === "running") {
    return;
  }
  const id = relay_identity(data);
  if (!id) {
    return;
  }
  if (!data.ready) {
    relay_team_by_id.delete(id);
    const idx = relay_ready_order_ids.indexOf(id);
    if (idx >= 0) {
      relay_ready_order_ids.splice(idx, 1);
    }
    relay_recompute_slots_from_ready_order();
    relay_emit_local_role();
    relay_emit_snapshots();
    return;
  }
  if (!data.team) {
    return;
  }
  relay_team_by_id.set(id, data.team);
  if (!relay_ready_order_ids.includes(id)) {
    relay_ready_order_ids.push(id);
  }
  relay_recompute_slots_from_ready_order();
  relay_emit_local_role();
  relay_emit_snapshots();
  relay_start_match_if_ready();
}

function relay_handle_intent(data: Extract<RoomPost, { $: "intent" }>): void {
  if (!relay_state || relay_ended) {
    return;
  }
  const id = relay_identity(data);
  if (!id) {
    return;
  }
  const slot_id = relay_slot_by_id.get(id);
  if (!slot_id) {
    return;
  }
  if (data.turn !== relay_turn) {
    return;
  }
  let validation_state = relay_state;
  if (relay_state.pendingSwitch[slot_id]) {
    const forced_target_candidate = Number.isInteger(data.forcedSwitchTargetIndex)
      ? data.forcedSwitchTargetIndex
      : relay_forced_switch_intents[slot_id];
    if (typeof forced_target_candidate !== "number" || !Number.isInteger(forced_target_candidate)) {
      return;
    }
    const forced_target = forced_target_candidate;
    const forced_preview = apply_forced_switch(relay_state, slot_id, forced_target);
    if (forced_preview.error) {
      return;
    }
    validation_state = forced_preview.state;
    relay_forced_switch_intents[slot_id] = forced_target;
  } else {
    relay_forced_switch_intents[slot_id] = null;
  }
  const validation = validate_intent(validation_state, slot_id, data.intent);
  if (validation) {
    return;
  }
  // Last selection in the turn wins for the same slot.
  relay_intents[slot_id] = data.intent;
  if (!relay_intents.player1 || !relay_intents.player2) {
    return;
  }
  for (const slot_check of PLAYER_SLOTS) {
    if (relay_state.pendingSwitch[slot_check] && !Number.isInteger(relay_forced_switch_intents[slot_check])) {
      return;
    }
  }
  let turn_state = relay_state;
  const pre_turn_log: EventLog[] = [];
  for (const slot_apply of PLAYER_SLOTS) {
    if (!turn_state.pendingSwitch[slot_apply]) {
      continue;
    }
    const target_candidate = relay_forced_switch_intents[slot_apply];
    if (typeof target_candidate !== "number" || !Number.isInteger(target_candidate)) {
      return;
    }
    const target_index = target_candidate;
    const switch_result = apply_forced_switch(turn_state, slot_apply, target_index);
    if (switch_result.error) {
      return;
    }
    turn_state = switch_result.state;
    pre_turn_log.push(...switch_result.log);
  }
  const { state, log } = resolve_turn(turn_state, {
    player1: relay_intents.player1,
    player2: relay_intents.player2
  });
  relay_state = state;
  emit_local_post({ $: "state", turn: relay_turn, state: relay_state, log: [...pre_turn_log, ...log] });
  if (relay_state.status === "ended") {
    relay_ended = true;
    relay_reset_match_to_lobby();
    return;
  }
  relay_start_turn();
}

function relay_handle_forced_switch(data: Extract<RoomPost, { $: "forced_switch" }>): void {
  if (!relay_state || relay_ended) {
    return;
  }
  const id = relay_identity(data);
  if (!id) {
    return;
  }
  const slot_id = relay_slot_by_id.get(id);
  if (!slot_id) {
    return;
  }
  if (!relay_state.pendingSwitch[slot_id]) {
    return;
  }
  const player = relay_state.players[slot_id];
  if (data.targetIndex < 0 || data.targetIndex >= player.team.length) {
    return;
  }
  if (data.targetIndex === player.activeIndex) {
    return;
  }
  if (player.team[data.targetIndex].hp <= 0) {
    return;
  }
  relay_forced_switch_intents[slot_id] = data.targetIndex;
}

function relay_handle_surrender(data: Extract<RoomPost, { $: "surrender" }>): void {
  if (!relay_state || relay_ended || "loser" in data) {
    return;
  }
  const id = relay_identity(data);
  if (!id) {
    return;
  }
  const loser = relay_slot_by_id.get(id);
  if (!loser) {
    return;
  }
  const winner: PlayerSlot = loser === "player1" ? "player2" : "player1";
  relay_state.status = "ended";
  relay_state.winner = winner;
  relay_ended = true;
  const log: EventLog[] = [
    {
      type: "match_end",
      turn: relay_turn,
      summary: `${winner} wins (surrender)`,
      data: { winner }
    }
  ];
  emit_local_post({ $: "state", turn: relay_turn, state: relay_state, log });
  emit_local_post({ $: "surrender", turn: relay_turn, loser, winner });
  relay_reset_match_to_lobby();
}

function relay_consume_post(data: RoomPost, seen_at: number): void {
  const id = relay_identity(data);
  if (id) {
    relay_last_seen_at.set(id, seen_at);
  }
  switch (data.$) {
    case "join":
      relay_handle_join(data);
      return;
    case "chat":
      emit_local_post(data);
      return;
    case "ready":
      relay_handle_ready(data);
      return;
    case "intent":
      relay_handle_intent(data);
      return;
    case "forced_switch":
      relay_handle_forced_switch(data);
      return;
    case "surrender":
      relay_handle_surrender(data);
      return;
    case "error":
      emit_local_post(data);
      return;
    default:
      return;
  }
}

function consume_network_message(message: any): void {
  const seen_at = typeof message?.server_time === "number" ? message.server_time : Date.now();
  const index = typeof message?.index === "number" ? message.index : -1;
  if (index >= 0) {
    if (relay_seen_indexes.has(index)) {
      return;
    }
    relay_seen_indexes.add(index);
  }
  const data: RoomPost | null = message && typeof message === "object" ? (message.data as RoomPost) : null;
  if (!data || typeof data !== "object" || typeof data.$ !== "string") {
    return;
  }
  if (is_server_managed_post(data)) {
    relay_server_managed = true;
    emit_local_post(data);
    return;
  }
  if (relay_server_managed) {
    emit_local_post(data);
    return;
  }
  relay_consume_post(data, seen_at);
  relay_prune_inactive(seen_at);
}

function ensure_participants_state(): { players: Record<PlayerSlot, string | null>; spectators: string[] } {
  if (!participants) {
    participants = {
      players: { player1: null, player2: null },
      spectators: []
    };
  }
  return participants;
}

function add_spectator(name: string): void {
  if (!name) return;
  const state = ensure_participants_state();
  if (state.players.player1 === name || state.players.player2 === name) {
    return;
  }
  if (!state.spectators.includes(name)) {
    state.spectators.push(name);
  }
}

function set_player_name(slot_id: PlayerSlot, name: string): void {
  const state = ensure_participants_state();
  state.players[slot_id] = name;
  state.spectators = state.spectators.filter((value) => value !== name);
}

function ensure_local_participant_visible(): void {
  const state = ensure_participants_state();
  const in_player_slot = state.players.player1 === player_name || state.players.player2 === player_name;
  if (!in_player_slot && !state.spectators.includes(player_name)) {
    state.spectators.push(player_name);
  }
}

function monster_label(id?: string, fallback: string = "mon"): string {
  if (!id) return fallback;
  return roster_by_id.get(id)?.name ?? id;
}

function move_label(id: string): string {
  return MOVE_LABELS[id] || id;
}

function passive_label(id: string): string {
  return PASSIVE_LABELS[id] || id;
}

function stat_label(value: unknown): string {
  if (value === "attack") return "ATK";
  if (value === "defense") return "DEF";
  if (value === "speed") return "SPE";
  if (value === "hp" || value === "maxHp") return "HP";
  if (typeof value === "string" && value.trim()) return value.trim().toUpperCase();
  return "STAT";
}

function format_multiplier(value: number): string {
  if (!Number.isFinite(value)) return "x?";
  if (Number.isInteger(value)) return `x${value}`;
  return `x${value.toFixed(2).replace(/0+$/, "").replace(/\.$/, "")}`;
}

function stat_mod_feedback(entry: EventLog): string | null {
  if (entry.type !== "stat_mod") {
    return null;
  }
  const data = entry.data as
    | {
        target?: unknown;
        stat?: unknown;
        before?: unknown;
        after?: unknown;
        multiplier?: unknown;
      }
    | undefined;
  if (!data) {
    return null;
  }

  const before = typeof data.before === "number" ? data.before : null;
  const after = typeof data.after === "number" ? data.after : null;
  if (before === null || after === null) {
    return null;
  }

  const target_name = typeof data.target === "string" ? monster_label(data.target) : "alvo";
  const label = stat_label(data.stat);
  const multiplier_text =
    typeof data.multiplier === "number" && Number.isFinite(data.multiplier) ? ` ${format_multiplier(data.multiplier)}` : "";

  if (before === after) {
    return `modificador sem efeito: ${target_name} ${label}${multiplier_text} (${before} -> ${after})`;
  }
  return `modificador aplicado: ${target_name} ${label}${multiplier_text} (${before} -> ${after})`;
}

function base_stats_for(monster_id: string, level?: number): { maxHp: number; attack: number; defense: number; speed: number } {
  const spec = roster_by_id.get(monster_id);
  if (!spec) {
    return { maxHp: 1, attack: 0, defense: 0, speed: 0 };
  }
  const base_stats = normalize_stats(spec.stats, spec.stats);
  const resolved_level = normalize_stat_value("level", level, base_stats.level);
  const baseline = stats_from_base_level_ev(base_stats, resolved_level, empty_ev_spread());
  return {
    maxHp: baseline.maxHp,
    attack: baseline.attack,
    defense: baseline.defense,
    speed: baseline.speed
  };
}

function tooltip_from_config(monster_id: string): MonsterTooltipPayload {
  const config = get_config(monster_id);
  const base = base_stats_for(monster_id, config.stats.level);
  return {
    id: monster_id,
    name: monster_label(monster_id),
    passive: config.passive,
    moves: config.moves.slice(0, 4),
    current: {
      hp: config.stats.maxHp,
      maxHp: config.stats.maxHp,
      attack: config.stats.attack,
      defense: config.stats.defense,
      speed: config.stats.speed
    },
    base
  };
}

function tooltip_from_state(mon: MonsterState): MonsterTooltipPayload {
  const base = base_stats_for(mon.id, mon.level);
  return {
    id: mon.id,
    name: monster_label(mon.id),
    passive: mon.chosenPassive,
    moves: mon.chosenMoves.slice(0, 4),
    current: {
      hp: Math.max(0, mon.hp),
      maxHp: mon.maxHp,
      attack: mon.attack,
      defense: mon.defense,
      speed: mon.speed
    },
    base
  };
}

function tooltip_value_state(current: number, base: number): TooltipValueState {
  if (current > base) return "up";
  if (current < base) return "down";
  return "neutral";
}

function set_monster_tooltip(target: HTMLElement | null, payload: MonsterTooltipPayload | null): void {
  if (!target) return;
  tooltip_payload_by_element.delete(target);
  target.removeAttribute("data-monster-tooltip");
  target.removeAttribute("title");
  if (!payload) {
    return;
  }
  tooltip_payload_by_element.set(target, payload);
  target.dataset.monsterTooltip = "1";
}

function tooltip_stat_row(label: string, current: number, base: number): HTMLDivElement {
  const row = document.createElement("div");
  row.className = "stat-tooltip-row";

  const label_el = document.createElement("span");
  label_el.className = "stat-tooltip-label";
  label_el.textContent = label;

  const value_el = document.createElement("span");
  value_el.className = `stat-tooltip-value ${tooltip_value_state(current, base)}`;
  value_el.textContent = `${current}`;

  row.appendChild(label_el);
  row.appendChild(value_el);
  return row;
}

function render_monster_tooltip(payload: MonsterTooltipPayload): void {
  if (!stat_tooltip) return;
  stat_tooltip.innerHTML = "";

  const title = document.createElement("div");
  title.className = "stat-tooltip-title";
  title.textContent = payload.name;
  stat_tooltip.appendChild(title);

  const stats_grid = document.createElement("div");
  stats_grid.className = "stat-tooltip-grid";
  stats_grid.appendChild(tooltip_stat_row("ATK", payload.current.attack, payload.base.attack));
  stats_grid.appendChild(tooltip_stat_row("DEF", payload.current.defense, payload.base.defense));
  stats_grid.appendChild(tooltip_stat_row("SPE", payload.current.speed, payload.base.speed));
  stats_grid.appendChild(tooltip_stat_row("HP", payload.current.maxHp, payload.base.maxHp));
  stat_tooltip.appendChild(stats_grid);

  const hp_line = document.createElement("div");
  hp_line.className = "stat-tooltip-hp";
  hp_line.textContent = `Vida atual: ${payload.current.hp}/${payload.current.maxHp}`;
  stat_tooltip.appendChild(hp_line);

  const passive_line = document.createElement("div");
  passive_line.className = "stat-tooltip-passive";
  passive_line.textContent = `Passive: ${passive_label(payload.passive)}`;
  stat_tooltip.appendChild(passive_line);

  const moves_box = document.createElement("div");
  moves_box.className = "stat-tooltip-moves";
  const moves = payload.moves.slice(0, 4);
  while (moves.length < 4) {
    moves.push("none");
  }
  moves.forEach((move, index) => {
    const row = document.createElement("div");
    row.textContent = `${index + 1}. ${move_label(move)}`;
    moves_box.appendChild(row);
  });
  stat_tooltip.appendChild(moves_box);
}

function position_tooltip(client_x: number, client_y: number): void {
  if (!stat_tooltip) return;
  const offset = 14;
  const margin = 10;
  const rect = stat_tooltip.getBoundingClientRect();
  let left = client_x + offset;
  let top = client_y + offset;

  if (left + rect.width > window.innerWidth - margin) {
    left = client_x - rect.width - offset;
  }
  if (top + rect.height > window.innerHeight - margin) {
    top = client_y - rect.height - offset;
  }
  left = Math.max(margin, left);
  top = Math.max(margin, top);

  stat_tooltip.style.left = `${left}px`;
  stat_tooltip.style.top = `${top}px`;
}

function tooltip_target_from_event(target: EventTarget | null): HTMLElement | null {
  if (!(target instanceof HTMLElement)) return null;
  const found = target.closest("[data-monster-tooltip='1']");
  return found instanceof HTMLElement ? found : null;
}

function open_tooltip(target: HTMLElement, client_x: number, client_y: number): void {
  if (!stat_tooltip) return;
  const payload = tooltip_payload_by_element.get(target);
  if (!payload) return;
  active_tooltip_target = target;
  render_monster_tooltip(payload);
  stat_tooltip.classList.add("is-open");
  stat_tooltip.setAttribute("aria-hidden", "false");
  position_tooltip(client_x, client_y);
}

function close_tooltip(): void {
  active_tooltip_target = null;
  if (!stat_tooltip) return;
  stat_tooltip.classList.remove("is-open");
  stat_tooltip.setAttribute("aria-hidden", "true");
}

function append_log(line: string): void {
  append_line(log_list, compact_slot_labels(line));
}

function append_chat(line: string): void {
  append_line(chat_messages, line);
}

function append_chat_user(name: string, message: string): void {
  append_line(chat_messages, `${name}: ${message}`, "log-user");
}

function append_turn_marker(turn: number): void {
  append_line(log_list, `turno ${turn}`, "log-turn");
}

function append_match_start_marker(game_number: number): void {
  append_line(log_list, `JOGO ${game_number}`, "log-match");
}

function append_match_end_marker(): void {
  append_line(log_list, "FIM DE JOGO", "log-match");
}

function compact_slot_labels(text: string): string {
  return text.replace(/\bplayer1\b/g, "P1").replace(/\bplayer2\b/g, "P2");
}

function try_post(data: RoomPost): boolean {
  try {
    post(room, data);
    return true;
  } catch (error) {
    const reason = error instanceof Error ? error.message : String(error);
    append_log(`send failed: ${reason}`);
    return false;
  }
}

function send_chat_message(message: string): void {
  const trimmed = message.trim();
  if (!trimmed) return;
  try_post({ $: "chat", message: trimmed.slice(0, 200), from: player_name, player_id });
}

function setup_chat_input(input: HTMLInputElement | null, button: HTMLButtonElement | null): void {
  if (!input || !button) return;
  input.disabled = false;
  button.disabled = false;
  input.placeholder = "Type message...";
  const handler = () => {
    send_chat_message(input.value);
    input.value = "";
  };
  button.addEventListener("click", handler);
  input.addEventListener("keydown", (event) => {
    if (event.key === "Enter") {
      handler();
    }
  });
}

function append_line(container: HTMLElement | null, line: string, class_name?: string): void {
  if (!container) return;
  const p = document.createElement("p");
  if (class_name) {
    p.classList.add(class_name);
  }
  p.textContent = line;
  container.appendChild(p);
  container.scrollTop = container.scrollHeight;
}

function render_participants(): void {
  ensure_local_participant_visible();
  participants_list.innerHTML = "";
  const state = ensure_participants_state();
  for (const slot_id of PLAYER_SLOTS) {
    const name = state.players[slot_id];
    if (!name) continue;
    const item = document.createElement("div");
    item.className = "participant";
    const meta = slot_id === "player1" ? "P1" : "P2";
    item.innerHTML = `<span>${name}</span><span class="participant-meta">${meta}</span>`;
    participants_list.appendChild(item);
  }
  const spectators = state.spectators.slice().sort((a, b) => a.localeCompare(b, undefined, { sensitivity: "base" }));
  for (const name of spectators) {
    const item = document.createElement("div");
    item.className = "participant";
    item.innerHTML = `<span>${name}</span><span class="participant-meta">spec</span>`;
    participants_list.appendChild(item);
  }
}

function update_deadline(): void {
  if (deadline_at <= 0) {
    status_deadline.textContent = "--:--";
    return;
  }
  const remaining = Math.max(0, deadline_at - Date.now());
  const minutes = Math.floor(remaining / 60000);
  const seconds = Math.floor((remaining % 60000) / 1000);
  status_deadline.textContent = `${minutes.toString().padStart(2, "0")}:${seconds
    .toString()
    .padStart(2, "0")}`;
}

function show_warning(message: string): void {
  config_warning.textContent = message;
}

function clear_warning(): void {
  config_warning.textContent = "";
}

function load_json<T>(key: string, fallback: T): T {
  try {
    const raw = localStorage.getItem(key);
    if (!raw) return fallback;
    return JSON.parse(raw) as T;
  } catch {
    return fallback;
  }
}

function save_json<T>(key: string, value: T): void {
  try {
    localStorage.setItem(key, JSON.stringify(value));
  } catch {}
}

function load_profile(): Profile {
  const parsed = load_json<Profile | null>(profile_key, null);
  if (parsed && typeof parsed === "object" && parsed.monsters) {
    return { monsters: parsed.monsters as Record<string, MonsterConfig> };
  }
  return { monsters: {} };
}

const profile = load_profile();

function save_profile(): void {
  save_json(profile_key, profile);
}

function load_team_selection(): void {
  const parsed = load_json<{ selected?: string[] } | null>(team_key, null);
  if (parsed && Array.isArray(parsed.selected)) {
    selected.splice(0, selected.length, ...parsed.selected.filter((id: string) => roster_by_id.has(id)));
  }
}

function save_team_selection(): void {
  save_json(team_key, { selected: selected.slice() });
}

function normalize_stat_value(key: keyof Stats, value: unknown, fallback: number): number {
  const candidate = typeof value === "number" ? value : fallback;
  if (key === "level") {
    return Math.min(LEVEL_MAX, Math.max(LEVEL_MIN, normalize_int(candidate, fallback, LEVEL_MIN)));
  }
  if (key === "maxHp") {
    return normalize_int(candidate, fallback, 1);
  }
  return normalize_int(candidate, fallback, 0);
}

function read_ev_value(value: unknown, fallback: number): number {
  return typeof value === "number" && Number.isFinite(value) ? value : fallback;
}

function ev_total(ev: EVSpread): number {
  return EV_KEYS.reduce((sum, key) => sum + ev[key], 0);
}

function normalize_ev_spread(value: unknown, fallback: EVSpread = empty_ev_spread()): EVSpread {
  const source = (typeof value === "object" && value !== null ? value : {}) as Partial<EVSpread>;
  return {
    hp: read_ev_value(source.hp, fallback.hp),
    atk: read_ev_value(source.atk, fallback.atk),
    def: read_ev_value(source.def, fallback.def),
    spe: read_ev_value(source.spe, fallback.spe)
  };
}

function normalize_legacy_ev_from_stat_alloc(value: unknown): EVSpread | null {
  const source =
    typeof value === "object" && value !== null
      ? (value as Partial<Record<"maxHp" | "attack" | "defense" | "speed", unknown>>)
      : null;
  if (!source) return null;
  return {
    hp: read_ev_value(source.maxHp, 0),
    atk: read_ev_value(source.attack, 0),
    def: read_ev_value(source.defense, 0),
    spe: read_ev_value(source.speed, 0)
  };
}

function stats_from_base_level_ev(base: Stats, level: number, ev: EVSpread): Stats {
  const final = calc_final_stats(
    {
      hp: base.maxHp,
      atk: base.attack,
      def: base.defense,
      spe: base.speed
    },
    level,
    ev
  );
  return {
    level,
    maxHp: final.hpMax,
    attack: final.atk,
    defense: final.def,
    speed: final.spe
  };
}

function normalize_stats(value: Partial<Stats> | undefined, fallback: Stats): Stats {
  const source = value ?? {};
  return {
    level: normalize_stat_value("level", source.level, fallback.level),
    maxHp: normalize_stat_value("maxHp", source.maxHp, fallback.maxHp),
    attack: normalize_stat_value("attack", source.attack, fallback.attack),
    defense: normalize_stat_value("defense", source.defense, fallback.defense),
    speed: normalize_stat_value("speed", source.speed, fallback.speed)
  };
}

function stats_equal(left: Stats, right: Stats): boolean {
  return (
    left.level === right.level &&
    left.maxHp === right.maxHp &&
    left.attack === right.attack &&
    left.defense === right.defense &&
    left.speed === right.speed
  );
}

function ev_equal(left: EVSpread, right: EVSpread): boolean {
  return (
    left.hp === right.hp &&
    left.atk === right.atk &&
    left.def === right.def &&
    left.spe === right.spe
  );
}

function coerce_config(spec: MonsterCatalogEntry, value?: MonsterConfig): MonsterConfig {
  const base_stats = normalize_stats(spec.stats, spec.stats);
  const base_level = normalize_stat_value("level", base_stats.level, 1);
  const base_ev = empty_ev_spread();
  const base: MonsterConfig = {
    moves: spec.defaultMoves.slice(0, 4),
    passive: spec.defaultPassive,
    stats: stats_from_base_level_ev(base_stats, base_level, base_ev),
    ev: base_ev
  };

  if (!value) {
    return base;
  }

  const moves = Array.isArray(value.moves) ? value.moves.slice(0, 4) : base.moves.slice();
  while (moves.length < 4) {
    moves.push("none");
  }
  const allowed = new Set(spec.possibleMoves);
  for (let i = 0; i < moves.length; i++) {
    if (moves[i] === "bells_drum") {
      moves[i] = "belly_drum";
    }
    if (!allowed.has(moves[i])) {
      moves[i] = "none";
    }
  }
  const allowed_passives = new Set(spec.possiblePassives.map(normalize_passive_id));
  let passive = normalize_passive_id(value.passive || base.passive);
  const fallback_passive = normalize_passive_id(base.passive);
  if (!allowed_passives.has(passive)) {
    passive = allowed_passives.has(fallback_passive) ? fallback_passive : "none";
  }

  const level = normalize_stat_value("level", value.stats?.level, base.stats.level);
  const legacy_ev = normalize_legacy_ev_from_stat_alloc((value as { statAlloc?: unknown }).statAlloc);
  const ev = normalize_ev_spread(value.ev ?? legacy_ev ?? base.ev, base.ev);
  const stats = stats_from_base_level_ev(base_stats, level, ev);

  return {
    moves,
    passive,
    stats,
    ev
  };
}

function get_config(monster_id: string): MonsterConfig {
  const spec = roster_by_id.get(monster_id);
  if (!spec) {
    throw new Error(`Missing monster spec: ${monster_id}`);
  }
  const config = coerce_config(spec, profile.monsters[monster_id]);
  profile.monsters[monster_id] = config;
  save_profile();
  return config;
}

function reset_profile_stats_to_defaults(): void {
  let changed = false;
  for (const spec of roster) {
    const config = coerce_config(spec, profile.monsters[spec.id]);
    const base_stats = normalize_stats(spec.stats, spec.stats);
    const default_ev = empty_ev_spread();
    const default_stats = stats_from_base_level_ev(base_stats, base_stats.level, default_ev);
    if (!stats_equal(config.stats, default_stats)) {
      changed = true;
    }
    if (!ev_equal(config.ev, default_ev)) {
      changed = true;
    }
    profile.monsters[spec.id] = {
      moves: config.moves.slice(0, 4),
      passive: config.passive,
      stats: default_stats,
      ev: default_ev
    };
  }

  save_profile();
  clear_warning();
  if (changed) {
    append_log("status reset to default values");
  }
  render_roster();
  render_tabs();
  render_config();
  update_roster_count();
  update_slots();
  update_action_controls();
}

function update_roster_count(): void {
  roster_count.textContent = `${selected.length}/3`;
}

function set_slot_card(
  index: number,
  card: HTMLButtonElement,
  img: HTMLImageElement,
  name_el: HTMLElement
): void {
  const id = selected[index];
  card.classList.toggle("show-badge", index === 0);
  if (!id) {
    card.classList.add("empty");
    card.classList.remove("active");
    set_monster_tooltip(card, null);
    img.classList.add("hidden");
    img.removeAttribute("src");
    img.alt = "";
    name_el.textContent = "empty";
    return;
  }
  card.classList.remove("empty");
  card.classList.toggle("active", id === active_tab);
  const tooltip = tooltip_from_config(id);
  set_monster_tooltip(card, tooltip);
  img.classList.remove("hidden");
  img.src = icon_path(id);
  img.alt = monster_label(id);
  name_el.textContent = monster_label(id);
}

function update_slots(): void {
  set_slot_card(0, slot_active, slot_active_img, slot_active_name);
  set_slot_card(1, slot_bench_a, slot_bench_a_img, slot_bench_a_name);
  set_slot_card(2, slot_bench_b, slot_bench_b_img, slot_bench_b_name);
}

function render_tabs(): void {
  if (monster_tabs) {
    monster_tabs.innerHTML = "";
  }
  if (selected.length === 0) {
    active_tab = null;
    render_config();
    return;
  }

  if (!active_tab || !selected.includes(active_tab)) {
    active_tab = selected[0];
  }
  render_config();
}

function render_config(): void {
  moves_grid.innerHTML = "";
  stats_grid.innerHTML = "";

  if (!active_tab) {
    show_warning("Select 3 monsters to configure.");
    return;
  }

  clear_warning();
  const spec = roster_by_id.get(active_tab);
  if (!spec) {
    show_warning("Unknown monster.");
    return;
  }

  const config = get_config(active_tab);
  const base_stats = normalize_stats(spec.stats, spec.stats);
  config.stats = stats_from_base_level_ev(base_stats, config.stats.level, config.ev);

  for (let i = 0; i < 4; i++) {
    const label = document.createElement("label");
    label.textContent = `Move ${i + 1}`;
    const select = document.createElement("select");
    select.dataset.index = `${i}`;
    for (const move of spec.possibleMoves) {
      const option = document.createElement("option");
      option.value = move;
      option.textContent = MOVE_LABELS[move] || move;
      select.appendChild(option);
    }
    select.value = config.moves[i] ?? "none";
    select.dataset.prev = select.value;
    select.disabled = is_ready && !match_started;
    select.addEventListener("change", () => {
      if (is_ready && !match_started) {
        select.value = select.dataset.prev || "none";
        return;
      }
      const idx = Number(select.dataset.index);
      const next = select.value;
      const prev = select.dataset.prev || "none";
      if (next !== "none") {
        const duplicate = config.moves.some((value, other) => other !== idx && value === next);
        if (duplicate) {
          select.value = prev;
          show_warning("Moves cannot repeat (except 'none').");
          return;
        }
      }
      config.moves[idx] = next;
      select.dataset.prev = next;
      clear_warning();
      save_profile();
      update_action_controls();
    });
    label.appendChild(select);
    moves_grid.appendChild(label);
  }

  const level_label = document.createElement("label");
  level_label.textContent = "Lv";
  const level_input = document.createElement("input");
  level_input.type = "number";
  level_input.min = `${LEVEL_MIN}`;
  level_input.max = `${LEVEL_MAX}`;
  level_input.value = `${config.stats.level}`;
  level_input.disabled = is_ready && !match_started;
  level_input.addEventListener("change", () => {
    if (is_ready && !match_started) return;
    const value = Number(level_input.value);
    if (!Number.isFinite(value)) {
      level_input.value = `${config.stats.level}`;
      return;
    }
    const normalized = normalize_stat_value("level", value, config.stats.level);
    config.stats = stats_from_base_level_ev(base_stats, normalized, config.ev);
    level_input.value = `${normalized}`;
    clear_warning();
    save_profile();
    render_config();
  });
  level_label.appendChild(level_input);
  moves_grid.appendChild(level_label);

  const passive_label = document.createElement("label");
  passive_label.textContent = "Passive";
  const passive_select = document.createElement("select");
  for (const passive of spec.possiblePassives) {
    const option = document.createElement("option");
    option.value = passive;
    option.textContent = PASSIVE_LABELS[passive] || passive;
    passive_select.appendChild(option);
  }
  passive_select.value = config.passive;
  passive_select.disabled = is_ready && !match_started;
  passive_select.addEventListener("change", () => {
    if (is_ready && !match_started) return;
    config.passive = passive_select.value;
    save_profile();
  });
  passive_label.appendChild(passive_select);
  moves_grid.appendChild(passive_label);

  const points_summary = document.createElement("div");
  points_summary.className = "stat-points-summary";
  stats_grid.appendChild(points_summary);

  const column_header = document.createElement("div");
  column_header.className = "stat-alloc-header";
  for (const heading of ["", "Base", "EV's", "", "Total"]) {
    const header_cell = document.createElement("span");
    header_cell.className = "stat-alloc-header-cell";
    if (heading.length === 0) {
      header_cell.classList.add("is-empty");
      header_cell.textContent = " ";
    } else {
      header_cell.textContent = heading;
    }
    column_header.appendChild(header_cell);
  }
  stats_grid.appendChild(column_header);

  const update_points_summary = (): void => {
    const used = ev_total(config.ev);
    const remaining = EV_TOTAL_MAX - used;
    points_summary.textContent = `EVs: ${used}/${EV_TOTAL_MAX} (restante: ${Math.max(0, remaining)})`;
  };

  const stat_rows: Array<[EVStatKey, string]> = [
    ["hp", "HP"],
    ["atk", "ATK"],
    ["def", "DEF"],
    ["spe", "SPE"]
  ];
  const stat_key_by_ev: Record<EVStatKey, keyof Stats> = {
    hp: "maxHp",
    atk: "attack",
    def: "defense",
    spe: "speed"
  };
  const calc_total_stat = (key: EVStatKey): number => {
    const base = base_stats[stat_key_by_ev[key]];
    const level = config.stats.level;
    const ev_quarter = Math.floor(config.ev[key] / 4);
    const scaled = Math.floor(((2 * base + ev_quarter) * level) / 100);
    if (key === "hp") {
      return scaled + level + 10;
    }
    return scaled + 5;
  };

  for (const [key, label_text] of stat_rows) {
    const row = document.createElement("div");
    row.className = "stat-alloc-row";

    const stat_name = document.createElement("span");
    stat_name.className = "stat-alloc-name";
    stat_name.textContent = label_text;

    const base_value = document.createElement("span");
    base_value.className = "stat-static-value";
    base_value.textContent = `${base_stats[stat_key_by_ev[key]]}`;

    const alloc_input = document.createElement("input");
    alloc_input.type = "number";
    alloc_input.className = "stat-alloc-input";
    alloc_input.min = "0";
    alloc_input.max = `${EV_PER_STAT_MAX}`;
    alloc_input.step = "1";
    alloc_input.value = `${config.ev[key]}`;
    alloc_input.disabled = is_ready && !match_started;

    const alloc_slider = document.createElement("input");
    alloc_slider.type = "range";
    alloc_slider.className = "stat-alloc-slider";
    alloc_slider.min = "0";
    alloc_slider.max = `${EV_PER_STAT_MAX}`;
    alloc_slider.value = `${config.ev[key]}`;
    alloc_slider.disabled = is_ready && !match_started;

    const result_value = document.createElement("span");
    result_value.className = "stat-result-value";
    result_value.textContent = `${calc_total_stat(key)}`;

    const apply_allocation_value = (next_raw: number): void => {
      const current = config.ev[key];
      if (!Number.isInteger(next_raw)) {
        show_warning(`EV ${key} must be integer.`);
        alloc_input.value = `${current}`;
        alloc_slider.value = `${current}`;
        return;
      }
      const candidate: EVSpread = { ...config.ev, [key]: next_raw };
      const ev_error = validate_ev_spread(candidate);
      if (ev_error) {
        show_warning(ev_error);
        alloc_input.value = `${current}`;
        alloc_slider.value = `${current}`;
        return;
      }
      config.ev = candidate;
      config.stats = stats_from_base_level_ev(base_stats, config.stats.level, config.ev);
      alloc_input.value = `${next_raw}`;
      alloc_slider.value = `${next_raw}`;
      result_value.textContent = `${calc_total_stat(key)}`;
      clear_warning();
      update_points_summary();
      save_profile();
    };

    alloc_input.addEventListener("change", () => {
      if (is_ready && !match_started) return;
      const value = Number(alloc_input.value);
      if (!Number.isFinite(value)) {
        alloc_input.value = `${config.ev[key]}`;
        return;
      }
      apply_allocation_value(value);
    });

    alloc_slider.addEventListener("input", () => {
      if (is_ready && !match_started) return;
      apply_allocation_value(Number(alloc_slider.value));
    });

    row.appendChild(stat_name);
    row.appendChild(base_value);
    row.appendChild(alloc_input);
    row.appendChild(alloc_slider);
    row.appendChild(result_value);
    stats_grid.appendChild(row);
  }

  update_points_summary();
}

function set_edit_target(index: number): void {
  if (is_ready && !match_started) {
    return;
  }
  const id = selected[index];
  if (!id) {
    return;
  }
  active_tab = id;
  update_slots();
  render_config();
}

function toggle_selection(id: string): void {
  if (is_ready && !match_started) {
    return;
  }
  const index = selected.indexOf(id);
  if (index >= 0) {
    selected.splice(index, 1);
    if (active_tab === id) {
      active_tab = selected[0] || null;
    }
    save_team_selection();
    update_roster_count();
    update_slots();
    render_tabs();
    render_config();
    render_roster();
    update_action_controls();
    return;
  }

  if (selected.length >= 3) {
    show_warning("Choose exactly 3 monsters.");
    return;
  }

  selected.push(id);
  active_tab = id;
  save_team_selection();
  update_roster_count();
  update_slots();
  render_tabs();
  render_config();
  render_roster();
  update_action_controls();
}

function render_roster(): void {
  const list = document.getElementById("roster-list")!;
  list.innerHTML = "";
  for (const entry of roster) {
    const card = document.createElement("div");
    const is_selected = selected.includes(entry.id);
    const is_disabled = (!is_selected && selected.length >= 3) || (is_ready && !match_started);
    const tooltip = tooltip_from_config(entry.id);
    card.className = `roster-card${is_selected ? " active" : ""}${is_disabled ? " disabled" : ""}`;
    set_monster_tooltip(card, tooltip);
    card.innerHTML = `
      <div class="sprite" style="width:24px;height:24px;">
        <img src="${icon_path(entry.id)}" alt="${entry.name}" />
      </div>
      <div>
        <h4>${entry.name}</h4>
        <p>${entry.role}</p>
      </div>
    `;
    card.addEventListener("click", () => {
      if (is_disabled) return;
      toggle_selection(entry.id);
    });
    list.appendChild(card);
  }
}

type BenchSlotEl = { btn: HTMLButtonElement; img: HTMLImageElement };

function set_bench_slot(slot: BenchSlotEl, mon: MonsterState | null, index: number | null, enabled: boolean): void {
  if (!mon || index === null || index < 0) {
    slot.btn.classList.add("empty");
    slot.btn.disabled = true;
    slot.btn.removeAttribute("data-index");
    set_monster_tooltip(slot.btn, null);
    slot.img.removeAttribute("src");
    slot.img.alt = "";
    slot.img.style.display = "none";
    return;
  }
  const tooltip = tooltip_from_state(mon);
  slot.btn.classList.remove("empty");
  slot.btn.dataset.index = `${index}`;
  set_monster_tooltip(slot.btn, tooltip);
  slot.btn.disabled = !enabled || mon.hp <= 0;
  slot.img.src = icon_path(mon.id);
  slot.img.alt = monster_label(mon.id);
  slot.img.style.display = "";
}

function update_bench(state: GameState, viewer_slot: PlayerSlot): void {
  const me = state.players[viewer_slot];
  const opp = state.players[viewer_slot === "player1" ? "player2" : "player1"];
  const my_bench = me.team.map((_, idx) => idx).filter((idx) => idx !== me.activeIndex);
  const opp_bench = opp.team.map((_, idx) => idx).filter((idx) => idx !== opp.activeIndex);
  const can_switch =
    !!slot &&
    slot === viewer_slot &&
    match_started &&
    !is_spectator &&
    (!!has_pending_switch() || current_turn > 0);

  player_bench_slots.forEach((slot_el, i) => {
    const idx = my_bench[i] ?? null;
    const mon = idx !== null ? me.team[idx] : null;
    set_bench_slot(slot_el, mon, idx, can_switch);
  });
  enemy_bench_slots.forEach((slot_el, i) => {
    const idx = opp_bench[i] ?? null;
    const mon = idx !== null ? opp.team[idx] : null;
    set_bench_slot(slot_el, mon, idx, false);
  });
}

function update_action_controls(): void {
  const has_team = selected.length === 3;
  const pending_switch = has_pending_switch();
  const forced_switch_ready = !relay_server_managed && has_forced_switch_target_for_current_turn();
  const controls_disabled = !match_started || !slot || is_spectator || current_turn <= 0 || (pending_switch && !forced_switch_ready);
  if (!has_team) {
    move_buttons.forEach((btn, index) => {
      btn.textContent = `Move ${index + 1}`;
      btn.disabled = true;
      btn.classList.remove("selected-intent");
    });
    if (switch_btn) switch_btn.disabled = true;
    return;
  }

  const active_id = selected[0];
  const config = get_config(active_id);
  let guard_on_cooldown = false;
  let choice_band_locked_move: number | null = null;
  let active_moves = config.moves;
  if (latest_state && slot) {
    const player_state = latest_state.players[slot];
    const fallback_active = player_state.team[player_state.activeIndex];
    const preview_active =
      pending_switch && has_forced_switch_target_for_current_turn() && typeof forced_switch_target_index === "number"
        ? player_state.team[forced_switch_target_index] ?? fallback_active
        : fallback_active;
    guard_on_cooldown = Math.max(preview_active.protectCooldownTurns, preview_active.endureCooldownTurns) > 0;
    active_moves = preview_active.chosenMoves;
    if (preview_active.chosenPassive === "choice_band") {
      choice_band_locked_move =
        typeof preview_active.choiceBandLockedMoveIndex === "number" ? preview_active.choiceBandLockedMoveIndex : null;
    }
  }
  move_buttons.forEach((btn, index) => {
    const move = active_moves[index] ?? "none";
    const label = MOVE_LABELS[move] || move;
    const locked_by_choice_band = choice_band_locked_move !== null && index !== choice_band_locked_move;
    const is_locked_slot = choice_band_locked_move !== null && index === choice_band_locked_move;
    if (locked_by_choice_band) {
      btn.textContent = `${index + 1}. ${label} (Choice Band lock)`;
      btn.disabled = true;
    } else if (move === "protect" && guard_on_cooldown) {
      btn.textContent = is_locked_slot ? `${index + 1}. Protect (cooldown, locked)` : `${index + 1}. Protect (cooldown)`;
      btn.disabled = true;
    } else if (move === "endure" && guard_on_cooldown) {
      btn.textContent = is_locked_slot ? `${index + 1}. Endure (cooldown, locked)` : `${index + 1}. Endure (cooldown)`;
      btn.disabled = true;
    } else {
      btn.textContent = is_locked_slot ? `${index + 1}. ${label} (locked)` : `${index + 1}. ${label}`;
      btn.disabled = controls_disabled;
    }
    const is_selected_move =
      selected_intent_turn === current_turn && selected_intent?.action === "use_move" && selected_intent.moveIndex === index;
    btn.classList.toggle("selected-intent", is_selected_move && !btn.disabled);
  });
  if (switch_btn) {
    const switch_disabled =
      !match_started ||
      !slot ||
      is_spectator ||
      current_turn <= 0;
    switch_btn.disabled = switch_disabled;
  }
  const show_surrender = match_started && !!slot && !is_spectator;
  surrender_btn.classList.toggle("hidden", !show_surrender);
  surrender_btn.disabled = !show_surrender;
  if (latest_state) {
    const viewer_slot = slot ?? (is_spectator ? "player1" : null);
    if (viewer_slot) {
      update_bench(latest_state, viewer_slot);
    }
  }
}

function has_pending_switch(): boolean {
  return !!(latest_state && slot && latest_state.pendingSwitch?.[slot]);
}

function clear_forced_switch_target(): void {
  forced_switch_target_index = null;
  forced_switch_target_turn = 0;
}

function has_forced_switch_target_for_current_turn(): boolean {
  return (
    has_pending_switch() &&
    typeof forced_switch_target_index === "number" &&
    forced_switch_target_turn === current_turn
  );
}

function post_turn_intent(intent: PlayerIntent): boolean {
  if (!can_send_intent()) {
    return false;
  }
  const post_data: Extract<RoomPost, { $: "intent" }> = {
    $: "intent",
    turn: current_turn,
    intent,
    player_id
  };
  if (has_pending_switch()) {
    if (relay_server_managed) {
      append_log("pending switch");
      return false;
    }
    if (!has_forced_switch_target_for_current_turn()) {
      append_log("choose replacement first");
      return false;
    }
    post_data.forcedSwitchTargetIndex = forced_switch_target_index!;
  }
  return try_post(post_data);
}

function can_send_intent(): boolean {
  if (current_turn <= 0) {
    append_log("turn not active yet");
    return false;
  }
  if (!slot) {
    append_log("slot not assigned");
    return false;
  }
  if (is_spectator) {
    return false;
  }
  return true;
}

function send_move_intent(moveIndex: number): void {
  if (!post_turn_intent({ action: "use_move", moveIndex })) {
    return;
  }
  const was_selected = selected_intent_turn === current_turn && selected_intent !== null;
  selected_intent = { action: "use_move", moveIndex };
  selected_intent_turn = current_turn;
  update_action_controls();
  append_log(was_selected ? "intent updated" : "intent sent");
}

function send_switch_intent(targetIndex: number): void {
  if (has_pending_switch()) {
    if (relay_server_managed) {
      if (try_post({ $: "forced_switch", targetIndex, player_id })) {
        close_switch_modal();
      }
      return;
    }
    forced_switch_target_index = targetIndex;
    forced_switch_target_turn = current_turn;
    append_log("replacement selected (hidden until turn resolves)");
    close_switch_modal();
    if (selected_intent_turn === current_turn && selected_intent) {
      const reposted = post_turn_intent(selected_intent);
      if (reposted) {
        append_log("intent updated");
      }
    }
    update_action_controls();
    return;
  }
  if (!post_turn_intent({ action: "switch", targetIndex })) {
    return;
  }
  const was_selected = selected_intent_turn === current_turn && selected_intent !== null;
  selected_intent = { action: "switch", targetIndex };
  selected_intent_turn = current_turn;
  update_action_controls();
  append_log(was_selected ? "intent updated" : "intent sent");
}

function send_surrender(): void {
  if (!match_started || is_spectator || !slot) return;
  try_post({ $: "surrender", player_id });
}

function close_switch_modal(): void {
  switch_modal.classList.remove("open");
}

function open_switch_modal(mode: "intent" | "forced" = "intent"): void {
  if (!latest_state || !slot) return;
  if (mode === "intent" && !can_send_intent()) return;
  switch_options.innerHTML = "";
  const player = latest_state.players[slot];
  const active_index = player.activeIndex;
  const options = player.team
    .map((mon, index) => ({ mon, index }))
    .filter((entry) => entry.index !== active_index);
  if (options.length === 0) {
    const msg = document.createElement("div");
    msg.textContent = "No available swaps";
    msg.style.fontSize = "11px";
    msg.style.color = "#9aa5b1";
    switch_options.appendChild(msg);
  } else {
    for (const entry of options) {
      const button = document.createElement("button");
      const is_alive = entry.mon.hp > 0;
      button.disabled = !is_alive;
      button.textContent = `${entry.mon.name}${is_alive ? "" : " (fainted)"}`;
      button.addEventListener("click", () => {
        if (mode === "intent") {
          send_switch_intent(entry.index);
          return;
        }
        send_switch_intent(entry.index);
      });
      switch_options.appendChild(button);
    }
  }
  switch_modal.classList.add("open");
}

function build_team_selection(): TeamSelection | null {
  if (selected.length !== 3) {
    show_warning("Select exactly 3 monsters before ready.");
    return null;
  }

  const monsters: TeamSelection["monsters"] = [];
  for (const id of selected) {
    const spec = roster_by_id.get(id);
    if (!spec) {
      show_warning(`Unknown monster: ${id}`);
      return null;
    }
    const base_stats = normalize_stats(spec.stats, spec.stats);
    const config = get_config(id);
    const ev_error = validate_ev_spread(config.ev);
    if (ev_error) {
      show_warning(`${monster_label(id)}: ${ev_error}`);
      return null;
    }
    const level = normalize_stat_value("level", config.stats.level, base_stats.level);
    const stats = stats_from_base_level_ev(base_stats, level, config.ev);
    config.stats = stats;
    monsters.push({
      id,
      moves: config.moves.slice(0, 4),
      passive: config.passive,
      stats: { ...stats },
      ev: { ...config.ev }
    });
  }

  clear_warning();
  save_profile();
  return { monsters, activeIndex: 0 };
}

function send_ready(next_ready: boolean): void {
  if (match_started) {
    return;
  }
  if (next_ready) {
    const team = build_team_selection();
    if (!team) {
      return;
    }
    try_post({ $: "ready", ready: true, team, player_id });
  } else {
    if (!slot) {
      return;
    }
    try_post({ $: "ready", ready: false, player_id });
  }
}

function update_ready_ui(): void {
  if (status_ready) {
    status_ready.textContent = is_ready ? "ready" : "not ready";
    status_ready.className = `status-pill ${is_ready ? "ok" : "off"}`;
  }
  ready_btn.textContent = is_ready ? "Unready" : "Ready";
  ready_btn.disabled = match_started;
  if (reset_status_btn) {
    reset_status_btn.disabled = match_started || is_ready;
  }
  if (match_started) {
    prematch_hint.textContent = "Match started.";
    return;
  }
  let hint = "Select 3 monsters, configure, then Ready.";
  if (is_ready) {
    hint = "Waiting for opponent...";
  } else if (opponent_ready) {
    hint = "Opponent is ready. Configure and click Ready.";
  } else if (is_spectator && !slot) {
    hint = "Spectator mode. Select 3 monsters and click Ready to join.";
  }
  prematch_hint.textContent = hint;
  render_roster();
  render_tabs();
  render_config();
}

function update_opponent_ui(opponent_ready: boolean, opponent_name: string | null): void {
  if (!status_opponent) return;
  status_opponent.textContent = opponent_ready ? "ready" : opponent_name ? "waiting" : "offline";
  status_opponent.className = `status-pill ${opponent_ready ? "ok" : opponent_name ? "warn" : "off"}`;
}

function show_match_end(winner?: PlayerSlot): void {
  if (!match_end) return;
  const is_winner = winner && slot === winner;
  match_end_title.textContent = is_winner ? "Victory" : "Defeat";
  if (!winner) {
    match_end_title.textContent = "Match ended";
  }
  match_end_sub.textContent = winner ? `${winner} wins the match.` : "Match finished.";
  match_end.classList.add("open");
}

function reset_to_lobby_view(): void {
  match_started = false;
  latest_state = null;
  current_turn = 0;
  deadline_at = 0;
  selected_intent = null;
  selected_intent_turn = 0;
  clear_forced_switch_target();
  close_switch_modal();
  match_end.classList.remove("open");
  prematch.style.display = "";
  document.body.classList.add("prematch-open");
  status_turn.textContent = "0";
  update_deadline();
  update_action_controls();
}

function handle_turn_start(data: { turn: number; deadline_at: number }): void {
  current_turn = data.turn;
  deadline_at = data.deadline_at;
  selected_intent = null;
  selected_intent_turn = 0;
  clear_forced_switch_target();
  status_turn.textContent = `${current_turn}`;
  update_deadline();
  if (current_turn === 1) {
    room_game_count += 1;
    append_match_start_marker(room_game_count);
  }
  append_turn_marker(current_turn);
  if (!has_pending_switch()) {
    close_switch_modal();
  }
  if (!match_started) {
    match_started = true;
    prematch.style.display = "none";
    document.body.classList.remove("prematch-open");
  }
  update_action_controls();
  if (slot && has_pending_switch() && !switch_modal.classList.contains("open")) {
    open_switch_modal("forced");
  }
}

function log_events(log: EventLog[]): void {
  for (const entry of log) {
    if (entry.type === "damage") {
      const data = entry.data as { slot?: PlayerSlot; damage?: number; target?: string } | undefined;
      const attacker_slot = data?.slot;
      const damage = data?.damage;
      if (attacker_slot && typeof damage === "number") {
        const attacker_id = latest_state?.players[attacker_slot]?.team[latest_state.players[attacker_slot].activeIndex]?.id;
        const attacker_name = monster_label(attacker_id);
        const defender_name = monster_label(data?.target);
        append_chat(`${attacker_name} deu ${damage} de dano em ${defender_name}`);
        continue;
      }
    }
    if (entry.type === "stat_mod") {
      append_log(stat_mod_feedback(entry) ?? entry.summary);
      continue;
    }
    append_log(entry.summary);
  }
}

function effect_chip(label: string, kind: "seeded" | "drain" | "buff" | "debuff" | "passive"): HTMLSpanElement {
  const chip = document.createElement("span");
  chip.className = `effect-chip ${kind}`;
  const dot = document.createElement("span");
  dot.className = "effect-dot";
  chip.appendChild(dot);
  chip.append(label);
  return chip;
}

function render_effects(
  state: GameState,
  viewer_slot: PlayerSlot,
  player_slot: PlayerSlot,
  enemy_slot: PlayerSlot
): void {
  const player_active = state.players[player_slot].team[state.players[player_slot].activeIndex];
  const enemy_active = state.players[enemy_slot].team[state.players[enemy_slot].activeIndex];
  const player_seeded_by = state.leechSeedSourceByTarget?.[player_slot] ?? null;
  const enemy_seeded_by = state.leechSeedSourceByTarget?.[enemy_slot] ?? null;
  const player_seeded = state.leechSeedActiveByTarget?.[player_slot] ?? !!player_seeded_by;
  const enemy_seeded = state.leechSeedActiveByTarget?.[enemy_slot] ?? !!enemy_seeded_by;

  player_sprite_wrap.classList.toggle("seeded", player_seeded);
  enemy_sprite_wrap.classList.toggle("seeded", enemy_seeded);

  if (player_effects) {
    player_effects.innerHTML = "";
    if (player_seeded) {
      player_effects.appendChild(effect_chip("Seeded", "seeded"));
    }
    if (enemy_seeded_by === viewer_slot) {
      player_effects.appendChild(effect_chip("Leech+", "drain"));
    }
    if (enemy_active.screechDebuffActive) {
      player_effects.appendChild(effect_chip("Screech (enemyDEF 0.5)", "debuff"));
    }
    if (player_active.agilityBoostActive) {
      player_effects.appendChild(effect_chip("Agility (mySPE 2)", "buff"));
    }
    if (player_active.endureSpeedBoostActive) {
      player_effects.appendChild(effect_chip("Endure (mySPE 1.5)", "buff"));
    }
    if (player_active.bellyDrumActive) {
      player_effects.appendChild(effect_chip("Belly Drum (myHP 0.5) (myATK 2)", "buff"));
    }
    if (normalize_passive_id(player_active.chosenPassive) === "choice_band") {
      player_effects.appendChild(effect_chip("Choice Band (myATK 1.5)", "passive"));
    }
  }

  if (enemy_effects) {
    enemy_effects.innerHTML = "";
    if (enemy_seeded) {
      enemy_effects.appendChild(effect_chip("Seeded", "seeded"));
    }
    if (player_seeded_by === enemy_slot) {
      enemy_effects.appendChild(effect_chip("Leech+", "drain"));
    }
    if (player_active.screechDebuffActive) {
      enemy_effects.appendChild(effect_chip("Screech (enemyDEF 0.5)", "debuff"));
    }
    if (enemy_active.agilityBoostActive) {
      enemy_effects.appendChild(effect_chip("Agility (mySPE 2)", "buff"));
    }
    if (enemy_active.endureSpeedBoostActive) {
      enemy_effects.appendChild(effect_chip("Endure (mySPE 1.5)", "buff"));
    }
    if (enemy_active.bellyDrumActive) {
      enemy_effects.appendChild(effect_chip("Belly Drum (myHP 0.5) (myATK 2)", "buff"));
    }
    if (normalize_passive_id(enemy_active.chosenPassive) === "choice_band") {
      enemy_effects.appendChild(effect_chip("Choice Band (myATK 1.5)", "passive"));
    }
  }
}

function update_panels(
  state: GameState,
  opts?: { skipMeta?: { player?: boolean; enemy?: boolean }; skipBar?: { player?: boolean; enemy?: boolean } }
): void {
  const viewer_slot = slot ?? (is_spectator ? "player1" : null);
  if (!viewer_slot) return;
  const enemy_slot = viewer_slot === "player1" ? "player2" : "player1";
  const me = state.players[viewer_slot];
  const opp = state.players[enemy_slot];
  const my_active = me.team[me.activeIndex];
  const opp_active = opp.team[opp.activeIndex];

  player_title.textContent = me.name || player_name;
  if (!opts?.skipMeta?.player) {
    player_meta.textContent = `Lv ${my_active.level} · HP ${my_active.hp}/${my_active.maxHp}`;
  }
  if (!opts?.skipBar?.player) {
    player_hp.style.width = `${Math.max(0, Math.min(1, my_active.hp / my_active.maxHp)) * 100}%`;
  }
  player_sprite.src = icon_path(my_active.id);
  player_sprite.alt = monster_label(my_active.id);
  set_monster_tooltip(player_sprite_wrap, tooltip_from_state(my_active));

  enemy_title.textContent = opp.name || "Opponent";
  if (!opts?.skipMeta?.enemy) {
    enemy_meta.textContent = `Lv ${opp_active.level} · HP ${opp_active.hp}/${opp_active.maxHp}`;
  }
  if (!opts?.skipBar?.enemy) {
    enemy_hp.style.width = `${Math.max(0, Math.min(1, opp_active.hp / opp_active.maxHp)) * 100}%`;
  }
  enemy_sprite.src = icon_path(opp_active.id);
  enemy_sprite.alt = monster_label(opp_active.id);
  set_monster_tooltip(enemy_sprite_wrap, tooltip_from_state(opp_active));
  render_effects(state, viewer_slot, viewer_slot, enemy_slot);
  update_bench(state, viewer_slot);
}

function animate_hp_text(
  side: "player" | "enemy",
  level: number,
  from: number,
  to: number,
  maxHp: number,
  delay: number = 180
): void {
  const target = side === "player" ? player_meta : enemy_meta;
  const start = performance.now();
  const duration = 260;
  const raf_key = side;
  if (hp_animation[raf_key]) {
    cancelAnimationFrame(hp_animation[raf_key]!);
  }
  const tick = (now: number) => {
    const elapsed = now - start;
    if (elapsed < delay) {
      hp_animation[raf_key] = requestAnimationFrame(tick);
      return;
    }
    const t = Math.min(1, (elapsed - delay) / duration);
    const value = Math.round(from + (to - from) * t);
    target.textContent = `Lv ${level} · HP ${value}/${maxHp}`;
    if (t < 1) {
      hp_animation[raf_key] = requestAnimationFrame(tick);
    }
  };
  hp_animation[raf_key] = requestAnimationFrame(tick);
}

function clear_animation_timers(): void {
  while (animation_timers.length) {
    const id = animation_timers.pop();
    if (id !== undefined) {
      clearTimeout(id);
    }
  }
  reset_sprite_fx();
}

function schedule_animation(fn: () => void, delay: number): void {
  const id = window.setTimeout(fn, delay);
  animation_timers.push(id);
}

function side_from_slot(viewer_slot: PlayerSlot | null, slot_id: PlayerSlot): "player" | "enemy" {
  if (!viewer_slot) {
    return slot_id === "player1" ? "player" : "enemy";
  }
  return slot_id === viewer_slot ? "player" : "enemy";
}

type VisualStep =
  | { kind: "damage"; attackerSide: "player" | "enemy"; defenderSide: "player" | "enemy"; from: number; to: number; level: number; maxHp: number }
  | { kind: "shield_on"; side: "player" | "enemy" }
  | { kind: "shield_hit"; attackerSide: "player" | "enemy"; defenderSide: "player" | "enemy" }
  | { kind: "heal"; side: "player" | "enemy" };

function build_visual_steps(prev_state: GameState, log: EventLog[], viewer_slot: PlayerSlot | null): VisualStep[] {
  const temp: GameState = JSON.parse(JSON.stringify(prev_state));
  const steps: VisualStep[] = [];
  for (const entry of log) {
    if (entry.type === "switch" || entry.type === "forced_switch") {
      const data = entry.data as { slot?: PlayerSlot; to?: number } | undefined;
      if (!data || !data.slot || typeof data.to !== "number") continue;
      temp.players[data.slot].activeIndex = data.to;
      continue;
    }
    if (entry.type === "protect") {
      const data = entry.data as { slot?: PlayerSlot } | undefined;
      if (!data?.slot) continue;
      const side = side_from_slot(viewer_slot, data.slot);
      steps.push({ kind: "shield_on", side });
      continue;
    }
    if (entry.type === "damage_blocked") {
      const data = entry.data as { slot?: PlayerSlot } | undefined;
      if (!data?.slot) continue;
      const defenderSide = side_from_slot(viewer_slot, data.slot);
      const attackerSide = defenderSide === "player" ? "enemy" : "player";
      steps.push({ kind: "shield_hit", attackerSide, defenderSide });
      continue;
    }
    if (entry.type === "passive_heal" || entry.type === "wish_heal" || entry.type === "leech_heal") {
      const data = entry.data as { slot?: PlayerSlot; amount?: number; before?: number; after?: number } | undefined;
      if (!data?.slot) continue;
      const target_player = temp.players[data.slot];
      const target_mon = target_player.team[target_player.activeIndex];
      if (typeof data.after === "number") {
        target_mon.hp = data.after;
      } else if (typeof data.before === "number") {
        const fallback_after = typeof data.amount === "number" ? data.before + data.amount : data.before;
        target_mon.hp = Math.min(target_mon.maxHp, Math.max(0, fallback_after));
      } else if (typeof data.amount === "number") {
        target_mon.hp = Math.min(target_mon.maxHp, Math.max(0, target_mon.hp + data.amount));
      }
      const side = side_from_slot(viewer_slot, data.slot);
      steps.push({ kind: "heal", side });
      continue;
    }
    if (entry.type !== "damage" && entry.type !== "recoil" && entry.type !== "leech_drain") continue;
    const payload = entry.data as
      | { slot?: PlayerSlot; damage?: number; targetSlot?: PlayerSlot; before?: number; after?: number }
      | undefined;
    if (!payload || typeof payload.damage !== "number" || payload.damage <= 0 || !payload.slot) {
      continue;
    }
    let defender_slot: PlayerSlot;
    if (entry.type === "recoil") {
      defender_slot = payload.slot;
    } else if (entry.type === "leech_drain") {
      defender_slot = payload.targetSlot ?? (payload.slot === "player1" ? "player2" : "player1");
    } else {
      defender_slot = payload.slot === "player1" ? "player2" : "player1";
    }
    const defender_player = temp.players[defender_slot];
    const defender = defender_player.team[defender_player.activeIndex];
    const from = typeof payload.before === "number" ? payload.before : defender.hp;
    const to = typeof payload.after === "number" ? payload.after : Math.max(0, from - payload.damage);
    defender.hp = to;
    const defenderSide = side_from_slot(viewer_slot, defender_slot);
    let attackerSide: "player" | "enemy";
    if (entry.type === "recoil") {
      attackerSide = defenderSide;
    } else {
      attackerSide = side_from_slot(viewer_slot, payload.slot);
    }
    steps.push({
      kind: "damage",
      attackerSide,
      defenderSide,
      from,
      to,
      level: defender.level,
      maxHp: defender.maxHp
    });
  }
  return steps;
}

function animate_hp_bar(bar: HTMLSpanElement, from: number, to: number): void {
  bar.classList.remove("hp-anim");
  bar.style.transition = "none";
  bar.style.width = `${from}%`;
  void bar.offsetWidth;
  bar.style.transition = "";
  bar.classList.add("hp-anim");
  bar.style.width = `${to}%`;
  window.setTimeout(() => {
    bar.classList.remove("hp-anim");
  }, 450);
}

function sprite_wrap(side: "player" | "enemy"): HTMLDivElement {
  return side === "player" ? player_sprite_wrap : enemy_sprite_wrap;
}

function reset_sprite_fx(): void {
  [player_sprite_wrap, enemy_sprite_wrap].forEach((wrap) => {
    sprite_fx_classes.forEach((fx) => wrap.classList.remove(fx));
    wrap.style.transform = "";
  });
}

function trigger_class(el: HTMLElement, className: string, duration: number): void {
  el.classList.remove(className);
  void el.offsetWidth;
  el.classList.add(className);
  window.setTimeout(() => {
    el.classList.remove(className);
  }, duration);
}

function handle_state(data: { state: GameState; log: EventLog[] }): void {
  const prev_state = latest_state;
  clear_animation_timers();
  const viewer_slot = slot ?? (is_spectator ? "player1" : null);
  const steps = prev_state ? build_visual_steps(prev_state, data.log, viewer_slot) : [];
  const hit_sides = new Set<"player" | "enemy">(
    steps.filter((step) => step.kind === "damage").map((step) => step.defenderSide)
  );
  latest_state = data.state;
  if (!(slot && data.state.pendingSwitch?.[slot])) {
    clear_forced_switch_target();
  }
  if (!match_started && data.state.status === "running") {
    match_started = true;
    prematch.style.display = "none";
    document.body.classList.remove("prematch-open");
  }
  update_panels(data.state, {
    skipMeta: {
      player: hit_sides.has("player"),
      enemy: hit_sides.has("enemy")
    },
    skipBar: {
      player: hit_sides.has("player"),
      enemy: hit_sides.has("enemy")
    }
  });
  if (steps.length > 0) {
    let cursor = 0;
    for (const step of steps) {
      const duration =
        step.kind === "damage" ? 650 : step.kind === "shield_hit" ? 420 : step.kind === "shield_on" ? 360 : 320;
      schedule_animation(() => {
        if (step.kind === "damage") {
          const attacker_wrap = sprite_wrap(step.attackerSide);
          const defender_wrap = sprite_wrap(step.defenderSide);
          trigger_class(attacker_wrap, "jump", 300);
          trigger_class(defender_wrap, "hit", 420);
          const bar = step.defenderSide === "player" ? player_hp : enemy_hp;
          const from_percent = Math.max(0, Math.min(1, step.from / step.maxHp)) * 100;
          const to_percent = Math.max(0, Math.min(1, step.to / step.maxHp)) * 100;
          animate_hp_bar(bar, from_percent, to_percent);
          animate_hp_text(step.defenderSide, step.level, step.from, step.to, step.maxHp, 180);
          return;
        }
        if (step.kind === "shield_on") {
          const wrap = sprite_wrap(step.side);
          trigger_class(wrap, "shield-on", 400);
          return;
        }
        if (step.kind === "shield_hit") {
          const attacker_wrap = sprite_wrap(step.attackerSide);
          const defender_wrap = sprite_wrap(step.defenderSide);
          trigger_class(attacker_wrap, "jump", 300);
          trigger_class(defender_wrap, "shield-hit", 450);
          return;
        }
        if (step.kind === "heal") {
          const wrap = sprite_wrap(step.side);
          trigger_class(wrap, "heal", 360);
        }
      }, cursor);
      cursor += duration;
    }
    schedule_animation(() => {
      update_panels(data.state);
    }, cursor + 50);
  } else {
    update_panels(data.state);
  }
  close_switch_modal();
  if (data.log.length) {
    log_events(data.log);
  }
  update_action_controls();
  if (data.state.status === "ended" && prev_state?.status !== "ended") {
    append_match_end_marker();
  }
  if (data.state.status === "ended") {
    show_match_end(data.state.winner);
  }
  if (slot && data.state.pendingSwitch?.[slot] && !switch_modal.classList.contains("open")) {
    open_switch_modal("forced");
  }
}

function handle_post(message: any): void {
  const data: RoomPost = message.data;
  switch (data.$) {
    case "assign":
      slot = data.slot;
      is_spectator = false;
      set_player_name(data.slot, data.name);
      if (status_slot) status_slot.textContent = data.slot === "player1" ? "P1" : "P2";
      if (status_conn) status_conn.textContent = "synced";
      player_meta.textContent = `Slot ${data.slot === "player1" ? "P1" : "P2"}`;
      append_log(`assigned ${data.slot}`);
      append_chat(`${data.name} assigned to ${data.slot === "player1" ? "P1" : "P2"}`);
      render_participants();
      return;
    case "ready_state": {
      const previous = last_ready_snapshot ?? { player1: false, player2: false };
      last_ready_snapshot = { ...data.ready };
      participants = {
        players: { ...data.names },
        spectators: participants ? participants.spectators.slice() : []
      };
      if (match_started && !data.ready.player1 && !data.ready.player2) {
        reset_to_lobby_view();
      }
      if (Array.isArray(data.order)) {
        ready_order = data.order.slice();
      } else {
        PLAYER_SLOTS.forEach((slot_id) => {
          const is_ready_now = data.ready[slot_id];
          const idx = ready_order.indexOf(slot_id);
          if (is_ready_now && idx === -1) {
            ready_order.push(slot_id);
          } else if (!is_ready_now && idx !== -1) {
            ready_order.splice(idx, 1);
          }
        });
      }
      PLAYER_SLOTS.forEach((slot_id) => {
        if (previous[slot_id] !== data.ready[slot_id]) {
          const name = data.names[slot_id];
          if (name) {
            append_chat(data.ready[slot_id] ? `${name} is ready` : `${name} is waiting`);
          }
        }
      });
      if (slot) {
        const opponent_slot = slot === "player1" ? "player2" : "player1";
        is_ready = data.ready[slot];
        opponent_ready = data.ready[opponent_slot];
        opponent_name = data.names[opponent_slot];
        update_opponent_ui(opponent_ready, opponent_name);
      } else {
        is_ready = false;
        opponent_ready = false;
        opponent_name = null;
        update_opponent_ui(false, null);
      }
      update_ready_ui();
      render_participants();
      return;
    }
    case "turn_start":
      handle_turn_start(data);
      return;
    case "intent_locked":
      append_log(`${data.slot} locked intent for turn ${data.turn}`);
      update_action_controls();
      return;
    case "state":
      handle_state(data);
      return;
    case "surrender":
      if ("loser" in data) {
        append_chat(`${data.loser === "player1" ? "P1" : "P2"} surrendered`);
      } else {
        append_log("surrender");
      }
      return;
    case "error":
      append_log(`error: ${data.message}`);
      show_warning(data.message);
      append_chat(`error: ${data.message}`);
      return;
    case "join":
      append_chat(`${data.name} joined the room`);
      add_spectator(data.name);
      render_participants();
      return;
    case "spectator":
      slot = null;
      is_spectator = true;
      is_ready = false;
      opponent_ready = false;
      opponent_name = null;
      add_spectator(data.name);
      if (status_slot) status_slot.textContent = "spectator";
      player_meta.textContent = "Spectator";
      update_opponent_ui(false, null);
      update_ready_ui();
      render_participants();
      return;
    case "chat":
      append_chat_user(data.from, data.message);
      return;
    case "participants":
      participants = { players: data.players, spectators: data.spectators.slice() };
      render_participants();
      return;
    case "intent":
      append_log(`intent received for turn ${data.turn}`);
      return;
  }
}

move_buttons.forEach((btn, index) => {
  btn.addEventListener("click", () => {
    send_move_intent(index);
  });
});

if (switch_btn) {
  switch_btn.addEventListener("click", () => {
    open_switch_modal(has_pending_switch() ? "forced" : "intent");
  });
}

surrender_btn.addEventListener("click", () => {
  send_surrender();
});

switch_close.addEventListener("click", () => {
  close_switch_modal();
});

switch_modal.addEventListener("click", (event) => {
  if (event.target === switch_modal) {
    close_switch_modal();
  }
});

ready_btn.addEventListener("click", () => {
  if (match_started) {
    return;
  }
  if (is_ready) {
    send_ready(false);
  } else {
    send_ready(true);
  }
});

if (reset_status_btn) {
  reset_status_btn.addEventListener("click", () => {
    if (match_started) {
      return;
    }
    if (is_ready) {
      show_warning("Click Unready before resetting status.");
      return;
    }
    reset_profile_stats_to_defaults();
  });
}

match_end_btn.addEventListener("click", () => {
  reset_to_lobby_view();
});

slot_active.addEventListener("click", () => {
  set_edit_target(0);
});
slot_bench_a.addEventListener("click", () => {
  set_edit_target(1);
});
slot_bench_b.addEventListener("click", () => {
  set_edit_target(2);
});

player_bench_slots.forEach((slot_el) => {
  slot_el.btn.addEventListener("click", () => {
    const index = Number(slot_el.btn.dataset.index);
    if (!Number.isFinite(index)) return;
    send_switch_intent(index);
  });
});

document.addEventListener("mouseover", (event) => {
  const target = tooltip_target_from_event(event.target);
  if (!target) {
    return;
  }
  const mouse = event as MouseEvent;
  open_tooltip(target, mouse.clientX, mouse.clientY);
});

document.addEventListener("mousemove", (event) => {
  if (!active_tooltip_target) {
    return;
  }
  const target = tooltip_target_from_event(event.target);
  if (target !== active_tooltip_target) {
    close_tooltip();
    return;
  }
  const mouse = event as MouseEvent;
  position_tooltip(mouse.clientX, mouse.clientY);
});

document.addEventListener("mouseout", (event) => {
  if (!active_tooltip_target) {
    return;
  }
  const from_target = tooltip_target_from_event(event.target);
  if (from_target !== active_tooltip_target) {
    return;
  }
  const related_target = tooltip_target_from_event((event as MouseEvent).relatedTarget);
  if (related_target === active_tooltip_target) {
    return;
  }
  close_tooltip();
});

window.addEventListener("blur", () => {
  close_tooltip();
});

setInterval(update_deadline, 1000);

setInterval(() => {
  const rtt = ping();
  if (isFinite(rtt)) {
    status_ping.textContent = `${Math.round(rtt)} ms`;
  } else {
    status_ping.textContent = "--";
  }
}, 1000);

setInterval(() => {
  if (!join_sent || relay_server_managed) {
    return;
  }
  try_post({ $: "join", name: player_name, player_id });
}, RELAY_JOIN_HEARTBEAT_MS);

setInterval(() => {
  if (relay_server_managed) {
    return;
  }
  relay_prune_inactive(Date.now());
}, 5000);

load_team_selection();
render_roster();
render_tabs();
render_config();
update_roster_count();
update_slots();
update_action_controls();
render_participants();

on_sync(() => {
  if (status_conn) status_conn.textContent = "synced";
  append_log(`connected: room=${room}`);
  append_log("sync complete");
  if (!chat_ready) {
    setup_chat_input(chat_input, chat_send);
    chat_ready = true;
  }
  if (!room_feed_started) {
    try {
      watch(room, consume_network_message);
      load(room, 0, consume_network_message);
      room_feed_started = true;
    } catch (error) {
      const reason = error instanceof Error ? error.message : String(error);
      append_log(`sync setup failed: ${reason}`);
      return;
    }
  }
  if (!join_sent) {
    if (try_post({ $: "join", name: player_name, player_id })) {
      append_log(`join request: ${player_name}`);
      join_sent = true;
    }
  }
});
