import { gen_name, load, on_sync, ping, post, watch } from "../src/client.ts";
import {
  MONSTER_BY_ID as roster_by_id,
  MONSTER_ROSTER as roster,
  MOVE_LABELS
} from "../src/data/exports.ts";
import { apply_forced_switch } from "../src/engine.ts";
import {
  BASE_TURN_LIMIT,
  SHARED_MSPE_START,
  TURN_DURATION_MS
} from "../src/shared.ts";
import type {
  MSPETelemetry,
  EVSpread,
  EventLog,
  GameState,
  MonsterType,
  MonsterState,
  PlayerIntent,
  PlayerSlot,
  RoomPost,
  Stats,
  TeamSelection
} from "../src/shared.ts";
import { mul_div_round, normalize_int } from "../src/int_math.ts";
import {
  EV_PER_STAT_MAX,
  EV_TOTAL_MAX,
  LEVEL_MAX,
  LEVEL_MIN,
  calc_non_hp_stat,
  validate_ev_spread
} from "../src/stats_calc.ts";
import { render_lobby_config } from "./lobby_render.ts";
import {
  type MonsterConfig,
  base_stats_from_spec,
  build_team_selection as build_lobby_team_selection,
  default_lobby_moves_for_spec,
  ev_total,
  get_config as get_lobby_config,
  load_profile as load_lobby_profile,
  load_team_selection as load_lobby_team_selection,
  normalize_ev_spread,
  normalize_stat_value,
  reset_profile_stats_to_defaults as reset_lobby_profile_stats,
  save_profile as save_lobby_profile,
  save_team_selection as save_lobby_team_selection,
  stats_from_base_level_ev
} from "./lobby_state.ts";
import { RelayRuntime } from "./relay_runtime.ts";

const STAT_STAGE_MIN = -6;
const STAT_STAGE_MAX = 6;
const TURN_DURATION_SECONDS_DEFAULT = Math.max(1, Math.floor(TURN_DURATION_MS / 1000));
const TURN_DURATION_SECONDS_MIN = 5;
const TURN_DURATION_SECONDS_MAX = 300;

type TooltipValueState = "up" | "down" | "neutral";

type MonsterTooltipPayload = {
  id: string;
  name: string;
  type: MonsterType;
  moves: string[];
  current: { attack: number; defense: number; speed: number };
  base: { attack: number; defense: number; speed: number };
  totalPercent: { attack: number; defense: number; speed: number };
  stages: { attack: number; defense: number; speed: number };
};

type SwitchModalMode = "intent" | "forced";

const LOBBY_MOVE_SLOTS = 3;
const STARTER_MONSTER_IDS = new Set<string>(["armoth", "kairus", "farien", "knight", "vealkiria", "babydragonbuf"]);
const STARTER_DEFAULT_PRIORITY_MOVE_IDS: string[] = (() => {
  const move_ids = new Set<string>();
  for (const monster_id of STARTER_MONSTER_IDS) {
    const spec = roster_by_id.get(monster_id);
    if (!spec) {
      continue;
    }
    for (const move_id of spec.defaultMoves) {
      if (move_id === "none" || move_id === "run") {
        continue;
      }
      move_ids.add(move_id);
    }
  }
  return Array.from(move_ids).sort((left, right) =>
    (MOVE_LABELS[left] || left).localeCompare(MOVE_LABELS[right] || right, undefined, { sensitivity: "base" })
  );
})();
const MOVE_TOOLTIP_DELAY_MS = 2000;
const MOVE_TOOLTIP_DESCRIPTIONS: Record<string, string> = {
  quick_attack: "Golpe rapido com prioridade de fase, ignorando comparacao de DEX.",
  punch: "Golpe fisico com multiplicador 93 (passa por DEF e armadura).",
  power: "Aumenta ATK em +1 stage no usuario e reduz DEX em 10% no proprio lado (permanente no slot).",
  hook:
    "Impede o Run do adversario neste turno; se ele tentar Run, recebe -20% de mSPE. Aplica Exposicao no usuario (+66% dano recebido em fases de ataque) e auto-aplica -10% de mSPE.",
  kick: "Golpe fisico forte de dano escalado.",
  throw: "Golpe com formula fixa (90x90) escalada pelo nivel de formula.",
  agility: "Buff de DEX (x2) ate trocar.",
  run: "Acao da fase Run (ultima): +10% de M.SPE sem reset por switch.",
  wish: "No proximo turno, no comeco do ending_turn, cura 50% do HP maximo do ativo.",
  rejuvenation:
    "Cura 50% do dano sofrido no turno (se houver), ativa regen de +30 por turno e cada recast adiciona +30 no proximo turno ate o maximo de +90.",
  switch_sovietico: "Arma switch obrigatorio para ambos no proximo turno.",
  team_cure: "Remove efeitos negativos e debuffs negativos do seu lado.",
  bait: "So funciona se tomou dano antes no turno; aplica Weakness por 2 turnos.",
  belly_drum: "Se HP atual > 50%, paga metade do HP atual e aumenta muito o ATK.",
  return: "Dano escalado; o poder sobe com o nivel atual da mutacao.",
  double_edge: "Golpe forte com recoil de 1/3 do dano final causado.",
  seismic_toss: "Dano flat fixo de 50, ignorando DEF.",
  leech_life: "Aplica Leech Seed (dreno no ending_turn) ate o alvo trocar.",
  sekyps:
    "Aplica o debuff Sekyps: no ending_turn causa dano flat 24 por stack (24/48/72/...), stacka ao reaplicar, nao remove no switch, cada stack novo so entra no dano no turno seguinte e nao causa dano no turno em que o alvo troca.",
  focus_punch: "Carrega e resolve no inicio do ending_turn; falha se tomar dano real antes.",
  pain_split: "Ambos ficam com floor((HP_user + HP_target)/2), respeitando clamp de HP.",
  screech: "Reduz DEF do alvo em 50% ate trocar.",
  taunt: "Forca o alvo a usar moves de ataque por 2 turnos.",
  spikes: "Arma Spikes no lado inimigo para causar dano em switches futuros.",
  recover: "Cura 20% do HP compartilhado maximo.",
  heal: "Cura 20% do HP compartilhado maximo.",
  mega_punch: "Golpe de dano flat 20.",
  meditate: "Aumenta o ATK por estagios (stackavel).",
  ki_blast: "Dano verdadeiro baseado na STR efetiva: 75% da STR (ignora DEF/armor).",
  endure: "Sobrevive ao dano letal no turno (minimo 1% HP) e ganha DEX ao ativar.",
  protect: "Bloqueia dano no turno. Compartilha cooldown com Endure.",
  none: "Nao faz acao neste turno."
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
const status_rps = document.getElementById("status-rps");
const status_evade = document.getElementById("status-mSPE");
const spec_view = document.getElementById("spec-view") as HTMLDivElement | null;
const spec_view_p1 = document.getElementById("spec-view-p1") as HTMLButtonElement | null;
const spec_view_p2 = document.getElementById("spec-view-p2") as HTMLButtonElement | null;
const status_ready = document.getElementById("status-ready");
const status_opponent = document.getElementById("status-opponent");
const chat_messages = document.getElementById("chat-messages")!;
const log_list = (document.getElementById("log-list") as HTMLElement | null) ?? chat_messages;
const chat_input = document.getElementById("chat-input") as HTMLInputElement | null;
const chat_send = document.getElementById("chat-send") as HTMLButtonElement | null;
const participants_list = document.getElementById("participants-list")!;
const stat_tooltip = document.getElementById("stat-tooltip") as HTMLDivElement | null;
const move_tooltip = document.getElementById("move-tooltip") as HTMLDivElement | null;

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
const turn_seconds_input = document.getElementById("turn-seconds-input") as HTMLInputElement | null;
const move_buttons = [
  document.getElementById("move-btn-0") as HTMLButtonElement,
  document.getElementById("move-btn-1") as HTMLButtonElement,
  document.getElementById("move-btn-2") as HTMLButtonElement
];
const run_btn = document.getElementById("run-btn") as HTMLButtonElement | null;
const surrender_btn = document.getElementById("surrender-btn") as HTMLButtonElement;
const switch_modal = document.getElementById("switch-modal") as HTMLDivElement;
const switch_title = switch_modal.querySelector(".switch-title") as HTMLDivElement | null;
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
let lobby_turn_duration_seconds = TURN_DURATION_SECONDS_DEFAULT;
let slot: PlayerSlot | null = null;
let is_ready = false;
let match_started = false;
let latest_state: GameState | null = null;
let opponent_ready = false;
let opponent_name: string | null = null;
let is_spectator = false;
let spectator_viewer_slot: PlayerSlot = "player1";
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
let move_tooltip_target: HTMLButtonElement | null = null;
let move_tooltip_pending_target: HTMLButtonElement | null = null;
let move_tooltip_delay_timer: number | null = null;
let move_tooltip_mouse_x = 0;
let move_tooltip_mouse_y = 0;

const RELAY_WATCHER_TTL_MS = 90_000;
const RELAY_JOIN_HEARTBEAT_MS = 25_000;
let relay_runtime: RelayRuntime;
let join_sent = false;
let room_feed_started = false;
let chat_ready = false;

let forced_switch_target_index: number | null = null;
let forced_switch_target_turn = 0;
let switch_modal_mode: SwitchModalMode = "intent";
let room_game_count = 0;

const ICON_ALIASES: Record<string, string> = {
  armoth: "panda",
  kairus: "harpy",
  farien: "miren",
  night_sekyps: "knight",
  vealkiria: "valkyria",
  babydragonbuf: "babydragon"
};

function icon_path(id: string): string {
  const resolved = ICON_ALIASES[id] ?? id;
  return `./icons/unit_${resolved}.png`;
}

function is_lobby_enabled_monster(id: string): boolean {
  return STARTER_MONSTER_IDS.has(id);
}

function monster_type_description(type: MonsterType): string {
  if (type === "def") return "DEF";
  if (type === "atk") return "ATK";
  return "BUF";
}

function default_evade_telemetry(): MSPETelemetry {
  return {
    effectiveMSPE: SHARED_MSPE_START,
    mSPEGoal: 500,
    mSPEReady: false,
    gapPercent: 0,
    gapGoalPercent: 33,
    gapReady: false,
    canMSPE: false
  };
}

function normalize_turn_duration_seconds(value: unknown, fallback: number = TURN_DURATION_SECONDS_DEFAULT): number {
  const raw =
    typeof value === "number"
      ? value
      : typeof value === "string" && value.trim().length > 0
        ? Number(value)
        : fallback;
  if (!Number.isFinite(raw)) {
    return fallback;
  }
  const normalized = normalize_int(raw, fallback, TURN_DURATION_SECONDS_MIN);
  return Math.max(TURN_DURATION_SECONDS_MIN, Math.min(TURN_DURATION_SECONDS_MAX, normalized));
}

function apply_turn_duration_seconds(next_seconds: number): void {
  const normalized = normalize_turn_duration_seconds(next_seconds, lobby_turn_duration_seconds);
  lobby_turn_duration_seconds = normalized;
  relay_runtime.set_turn_duration_ms(normalized * 1000);
  update_turn_duration_input();
}

function update_turn_duration_input(): void {
  if (!turn_seconds_input) {
    return;
  }
  turn_seconds_input.value = `${lobby_turn_duration_seconds}`;
  turn_seconds_input.disabled = match_started || is_ready;
}

function send_turn_duration_config(next_seconds: number): void {
  const normalized = normalize_turn_duration_seconds(next_seconds, lobby_turn_duration_seconds);
  const changed = normalized !== lobby_turn_duration_seconds;
  apply_turn_duration_seconds(normalized);
  if (!changed || match_started) {
    return;
  }
  try_post({ $: "turn_config", turnDurationSeconds: normalized, player_id });
}

function read_evade_telemetry(state: GameState, slot_id: PlayerSlot): MSPETelemetry {
  const input = state.mSPETelemetry?.[slot_id] as
    | (Partial<MSPETelemetry> & {
        effectiveSpeed?: unknown;
        speedGoal?: unknown;
        speedReady?: unknown;
      })
    | undefined;
  if (!input) {
    return default_evade_telemetry();
  }
  const evade_goal_raw =
    Number.isFinite(input.mSPEGoal) && (input.mSPEGoal as number) > 0
      ? (input.mSPEGoal as number)
      : Number.isFinite(input.speedGoal) && (input.speedGoal as number) > 0
        ? (input.speedGoal as number)
        : 500;
  const evade_goal = Math.floor(evade_goal_raw);
  const gap_goal_raw = typeof input.gapGoalPercent === "number" ? input.gapGoalPercent : 33;
  const gap_goal = Number.isFinite(gap_goal_raw) && gap_goal_raw > 0 ? Math.floor(gap_goal_raw) : 33;
  const evade_raw = Number.isFinite(input.effectiveMSPE)
    ? (input.effectiveMSPE as number)
    : Number.isFinite(input.effectiveSpeed)
      ? (input.effectiveSpeed as number)
      : SHARED_MSPE_START;
  const mSPE = Math.max(0, Math.floor(evade_raw));
  const gap = typeof input.gapPercent === "number" && Number.isFinite(input.gapPercent) ? Math.round(input.gapPercent) : 0;
  const evade_ready = !!input.mSPEReady || !!input.speedReady || mSPE >= evade_goal;
  const gap_ready = !!input.gapReady || gap >= gap_goal;
  return {
    effectiveMSPE: mSPE,
    mSPEGoal: evade_goal,
    mSPEReady: evade_ready,
    gapPercent: gap,
    gapGoalPercent: gap_goal,
    gapReady: gap_ready,
    canMSPE: !!input.canMSPE || evade_ready || gap_ready
  };
}

function signed_percent(value: number): string {
  if (!Number.isFinite(value)) {
    return "0%";
  }
  const rounded = Math.round(value);
  return `${rounded >= 0 ? "+" : ""}${rounded}%`;
}

function current_viewer_slot(): PlayerSlot | null {
  if (slot) {
    return slot;
  }
  if (is_spectator) {
    return spectator_viewer_slot;
  }
  return null;
}

function update_spec_view_controls(): void {
  if (!spec_view || !spec_view_p1 || !spec_view_p2) {
    return;
  }
  const visible = is_spectator && !slot;
  spec_view.hidden = !visible;
  spec_view_p1.classList.toggle("active", spectator_viewer_slot === "player1");
  spec_view_p2.classList.toggle("active", spectator_viewer_slot === "player2");
  spec_view_p1.disabled = spectator_viewer_slot === "player1";
  spec_view_p2.disabled = spectator_viewer_slot === "player2";
}

function set_spectator_viewer_slot(next_slot: PlayerSlot): void {
  spectator_viewer_slot = next_slot;
  update_spec_view_controls();
  if (!latest_state) {
    return;
  }
  update_panels(latest_state);
  update_action_controls();
}

function update_evade_status(state: GameState | null): void {
  if (!status_evade) {
    return;
  }
  status_evade.classList.remove("ready");
  if (!state) {
    status_evade.textContent = "mSPE --";
    return;
  }
  const p1 = read_evade_telemetry(state, "player1");
  const p2 = read_evade_telemetry(state, "player2");
  if (!slot) {
    status_evade.textContent = `mSPE P1 ${p1.effectiveMSPE}/${p1.mSPEGoal} ${signed_percent(p1.gapPercent)}/${p1.gapGoalPercent}% | P2 ${p2.effectiveMSPE}/${p2.mSPEGoal} ${signed_percent(p2.gapPercent)}/${p2.gapGoalPercent}%`;
    if (p1.canMSPE || p2.canMSPE) {
      status_evade.classList.add("ready");
    }
    return;
  }
  const enemy_slot = slot === "player1" ? "player2" : "player1";
  const mine = read_evade_telemetry(state, slot);
  const enemy = read_evade_telemetry(state, enemy_slot);
  status_evade.textContent = `mSPE ME ${mine.effectiveMSPE}/${mine.mSPEGoal} ${signed_percent(mine.gapPercent)}/${mine.gapGoalPercent}% | EN ${enemy.effectiveMSPE}/${enemy.mSPEGoal} ${signed_percent(enemy.gapPercent)}/${enemy.gapGoalPercent}%`;
  if (mine.canMSPE) {
    status_evade.classList.add("ready");
  }
}

function update_rps_status(state: GameState | null): void {
  if (status_rps) {
    if (!state) {
      status_rps.textContent = "PTS -- | --";
    } else {
      const p1 = state.rpsScore?.player1 ?? 0;
      const p2 = state.rpsScore?.player2 ?? 0;
      if (!slot) {
        status_rps.textContent = `PTS P1 ${p1} | P2 ${p2}`;
      } else {
        const enemy_slot = slot === "player1" ? "player2" : "player1";
        const my_score = state.rpsScore?.[slot] ?? 0;
        const enemy_score = state.rpsScore?.[enemy_slot] ?? 0;
        status_rps.textContent = `PTS ${my_score} x ${enemy_score}`;
      }
    }
  }
  update_evade_status(state);
}

function emit_local_post(data: RoomPost): void {
  handle_post({ data });
}

relay_runtime = new RelayRuntime({
  player_id,
  relay_watcher_ttl_ms: RELAY_WATCHER_TTL_MS,
  turn_duration_ms: TURN_DURATION_MS,
  emit_local_post,
  append_chat
});

function consume_network_message(message: unknown): void {
  relay_runtime.consume_network_message(message);
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

function stat_label(value: unknown): string {
  if (value === "attack") return "ATK";
  if (value === "defense") return "DEF";
  if (value === "speed") return "DEX";
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

function base_stats_for(
  monster_id: string,
  level?: number,
  ev?: EVSpread
): { attack: number; defense: number; speed: number } {
  const spec = roster_by_id.get(monster_id);
  if (!spec) {
    return { attack: 0, defense: 0, speed: 0 };
  }
  const base_stats = base_stats_from_spec(spec);
  const resolved_level = normalize_stat_value("level", level, base_stats.level);
  const resolved_ev = normalize_ev_spread(ev);
  const baseline = stats_from_base_level_ev(base_stats, resolved_level, resolved_ev);
  return {
    attack: baseline.attack,
    defense: baseline.defense,
    speed: baseline.speed
  };
}

const TOOLTIP_ARMOR_STACK_MAX = 5;
const TOOLTIP_ARMOR_BONUS_PERCENT_PER_STACK = 10;
const TOOLTIP_STAT_MULTIPLIER_MIN_PERCENT = 25;
const TOOLTIP_STAT_MULTIPLIER_MAX_PERCENT = 400;
const REJUVENATION_REGEN_PER_STACK = 30;
const LEECH_SEED_HP_DIVISOR = 8;
const SEKYPS_DAMAGE_PER_STACK_UI = 24;
type TooltipStatKey = "attack" | "defense" | "speed";
type UiBuffDebuffEntry = { id: string; stat: TooltipStatKey; deltaPercent: number };
type TooltipBuffDebuffReadOptions = {
  monsterId?: string;
  clearOnSwitchPreview?: boolean;
};
type UiStatAggregate = {
  stat: TooltipStatKey;
  totalDeltaPercent: number;
  totalStageDelta: number;
};
const POWER_ATTACK_STAGE_UI_IDS = new Set<string>(["power_attack_up", "power_attack_stage_up"]);

function armor_stacks_for_slot(state: GameState, slot_id: PlayerSlot): number {
  const raw = state.typePassiveArmorStacks?.[slot_id] ?? 0;
  if (!Number.isFinite(raw)) {
    return 0;
  }
  return Math.max(0, Math.min(TOOLTIP_ARMOR_STACK_MAX, Math.floor(raw)));
}

function clamp_tooltip_total_percent(total_percent: number): number {
  return Math.max(TOOLTIP_STAT_MULTIPLIER_MIN_PERCENT, Math.min(TOOLTIP_STAT_MULTIPLIER_MAX_PERCENT, total_percent));
}

function tooltip_stat_delta_sum(entries: UiBuffDebuffEntry[], stat: TooltipStatKey): number {
  let total = 0;
  for (const entry of entries) {
    if (entry.stat !== stat) {
      continue;
    }
    total += entry.deltaPercent;
  }
  return total;
}

function stage_delta_from_buff_entry(entry: UiBuffDebuffEntry): number {
  if (entry.stat === "attack" && POWER_ATTACK_STAGE_UI_IDS.has(entry.id)) {
    return 1;
  }
  return 0;
}

function stat_aggregates_from_entries(entries: UiBuffDebuffEntry[]): UiStatAggregate[] {
  const by_stat: Record<TooltipStatKey, UiStatAggregate> = {
    attack: { stat: "attack", totalDeltaPercent: 0, totalStageDelta: 0 },
    defense: { stat: "defense", totalDeltaPercent: 0, totalStageDelta: 0 },
    speed: { stat: "speed", totalDeltaPercent: 0, totalStageDelta: 0 }
  };
  for (const entry of entries) {
    by_stat[entry.stat].totalDeltaPercent += entry.deltaPercent;
    by_stat[entry.stat].totalStageDelta += stage_delta_from_buff_entry(entry);
  }
  return [by_stat.attack, by_stat.defense, by_stat.speed];
}

function stat_aggregate_for(entries: UiBuffDebuffEntry[], stat: TooltipStatKey): UiStatAggregate {
  return stat_aggregates_from_entries(entries).find((entry) => entry.stat === stat) ?? {
    stat,
    totalDeltaPercent: 0,
    totalStageDelta: 0
  };
}

function active_buff_debuffs_for_slot(
  state: GameState,
  slot_id: PlayerSlot,
  options?: TooltipBuffDebuffReadOptions
): UiBuffDebuffEntry[] {
  const raw = state.activeBuffDebuffsBySlot?.[slot_id];
  if (!Array.isArray(raw)) {
    return [];
  }
  const player = state.players[slot_id];
  const selected_monster_id =
    typeof options?.monsterId === "string" && options.monsterId.trim().length > 0
      ? options.monsterId
      : (player.team[player.activeIndex]?.id ?? null);
  const clear_on_switch_preview = options?.clearOnSwitchPreview === true;
  const normalized: UiBuffDebuffEntry[] = [];
  for (const row of raw) {
    if (clear_on_switch_preview && row.clearsOnSwitch === true) {
      continue;
    }
    const target_monster_id =
      typeof row.targetMonsterId === "string" && row.targetMonsterId.trim().length > 0 ? row.targetMonsterId : null;
    if (target_monster_id && selected_monster_id && target_monster_id !== selected_monster_id) {
      continue;
    }
    if (target_monster_id && !selected_monster_id) {
      continue;
    }
    const id = typeof row.id === "string" && row.id.trim().length > 0 ? row.id : "buff_debuff";
    const stat = row.stat;
    if (stat !== "attack" && stat !== "defense" && stat !== "speed") {
      continue;
    }
    const delta = typeof row.deltaPercent === "number" && Number.isFinite(row.deltaPercent) ? Math.trunc(row.deltaPercent) : 0;
    normalized.push({ id, stat, deltaPercent: delta });
  }
  return normalized;
}

function has_active_effect(state: GameState, slot_id: PlayerSlot, effect_id: string): boolean {
  const effects = state.activeEffectsBySlot?.[slot_id];
  if (!Array.isArray(effects)) {
    return false;
  }
  return effects.some((row) => row?.id === effect_id);
}

function tooltip_total_percent_for_stat(
  state: GameState,
  slot_id: PlayerSlot,
  stat: TooltipStatKey,
  entries: UiBuffDebuffEntry[]
): number {
  let total = 100 + tooltip_stat_delta_sum(entries, stat);
  if (stat === "defense") {
    total += armor_stacks_for_slot(state, slot_id) * TOOLTIP_ARMOR_BONUS_PERCENT_PER_STACK;
  }
  return clamp_tooltip_total_percent(total);
}

function tooltip_stat_value_from_percent(base: number, total_percent: number): number {
  return Math.max(0, mul_div_round(base, total_percent, 100));
}

function clamp_stage(value: number): number {
  return Math.max(STAT_STAGE_MIN, Math.min(STAT_STAGE_MAX, Math.trunc(value)));
}

function attack_from_stage(base_attack: number, stage: number): number {
  const normalized = clamp_stage(stage);
  if (normalized >= 0) {
    return Math.max(0, mul_div_round(base_attack, 2 + normalized, 2));
  }
  return Math.max(0, mul_div_round(base_attack, 2, 2 - normalized));
}

function tooltip_from_config(monster_id: string): MonsterTooltipPayload {
  const config = get_config(monster_id);
  const base = base_stats_for(monster_id, config.stats.level, config.ev);
  const spec = roster_by_id.get(monster_id);
  const type = spec?.type ?? "atk";
  return {
    id: monster_id,
    name: monster_label(monster_id),
    type,
    moves: config.moves.slice(0, LOBBY_MOVE_SLOTS),
    current: {
      attack: config.stats.attack,
      defense: config.stats.defense,
      speed: config.stats.speed
    },
    base,
    totalPercent: {
      attack: 100,
      defense: 100,
      speed: 100
    },
    stages: {
      attack: 0,
      defense: 0,
      speed: 0
    }
  };
}

function tooltip_from_state(
  state: GameState,
  slot_id: PlayerSlot,
  mon: MonsterState,
  options?: { previewSwitchIn?: boolean }
): MonsterTooltipPayload {
  const fallback_base = base_stats_for(mon.id, mon.level);
  const base = {
    attack: Math.max(0, Number.isFinite(mon.baseAttack) ? Math.trunc(mon.baseAttack) : fallback_base.attack),
    defense: Math.max(0, Number.isFinite(mon.baseDefense) ? Math.trunc(mon.baseDefense) : fallback_base.defense),
    speed: Math.max(0, Number.isFinite(mon.baseSpeed) ? Math.trunc(mon.baseSpeed) : fallback_base.speed)
  };
  const preview_switch_in = options?.previewSwitchIn === true;
  const entries = active_buff_debuffs_for_slot(state, slot_id, {
    monsterId: mon.id,
    clearOnSwitchPreview: preview_switch_in
  });
  const attack_aggregate = stat_aggregate_for(entries, "attack");
  const attack_total_percent = tooltip_total_percent_for_stat(state, slot_id, "attack", entries);
  const defense_total_percent = tooltip_total_percent_for_stat(state, slot_id, "defense", entries);
  const speed_total_percent = tooltip_total_percent_for_stat(state, slot_id, "speed", entries);
  const weakness_active = has_active_effect(state, slot_id, "weakness");
  const defense_blocked = has_active_effect(state, slot_id, "deterioration");
  const speed_blocked = has_active_effect(state, slot_id, "paralyse");
  const attack_percented_base = tooltip_stat_value_from_percent(base.attack, attack_total_percent);
  const defense_percented_base = tooltip_stat_value_from_percent(base.defense, defense_total_percent);
  const speed_percented_base = tooltip_stat_value_from_percent(base.speed, speed_total_percent);
  const attack_stage_base = clamp_stage(Number.isFinite(mon.attackStage) ? mon.attackStage : 0);
  const attack_stage_with_buff_entries = clamp_stage(attack_stage_base + attack_aggregate.totalStageDelta);
  const defense_stage_base = clamp_stage(Number.isFinite(mon.defenseStage) ? mon.defenseStage : 0);
  const speed_stage_base = clamp_stage(Number.isFinite(mon.speedStage) ? mon.speedStage : 0);
  const attack_stage_for_display = weakness_active
    ? clamp_stage(attack_stage_with_buff_entries - 2)
    : attack_stage_with_buff_entries;
  const attack_value = attack_from_stage(attack_percented_base, attack_stage_for_display);
  const defense_value = attack_from_stage(defense_percented_base, defense_stage_base);
  const speed_value = attack_from_stage(speed_percented_base, speed_stage_base);
  return {
    id: mon.id,
    name: monster_label(mon.id),
    type: mon.type,
    moves: mon.chosenMoves.slice(0, LOBBY_MOVE_SLOTS),
    current: {
      attack: attack_value,
      defense: defense_blocked ? 0 : defense_value,
      speed: speed_blocked ? 0 : speed_value
    },
    base,
    totalPercent: {
      attack: attack_total_percent,
      defense: defense_total_percent,
      speed: speed_total_percent
    },
    stages: {
      attack: attack_stage_for_display,
      defense: defense_stage_base,
      speed: speed_stage_base
    }
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

function percent_value_state(percent: number): TooltipValueState {
  if (percent > 100) return "up";
  if (percent < 100) return "down";
  return "neutral";
}

function tooltip_stat_row(label: string, current: number, base: number, stage: number, total_percent: number): HTMLDivElement {
  const row = document.createElement("div");
  row.className = "stat-tooltip-row";

  const label_el = document.createElement("span");
  label_el.className = "stat-tooltip-label";
  label_el.textContent = `${label} |`;

  const value_el = document.createElement("span");
  value_el.className = `stat-tooltip-value ${tooltip_value_state(current, base)}`;
  value_el.textContent = `${current} |`;

  const stage_el = document.createElement("span");
  stage_el.className = "stat-tooltip-stage";
  stage_el.textContent = `${format_tooltip_stage(stage)} |`;

  const percent_el = document.createElement("span");
  percent_el.className = `stat-tooltip-percent ${percent_value_state(total_percent)}`;
  percent_el.textContent = format_tooltip_percent(total_percent);

  row.appendChild(label_el);
  row.appendChild(value_el);
  row.appendChild(stage_el);
  row.appendChild(percent_el);
  return row;
}

function format_tooltip_stage(stage: number): string {
  const normalized = clamp_stage(stage);
  return `stg ${normalized >= 0 ? `+${normalized}` : `${normalized}`}`;
}

function format_tooltip_percent(percent: number): string {
  const delta = percent - 100;
  return `${delta >= 0 ? "+" : ""}${delta}%`;
}

function render_monster_tooltip(payload: MonsterTooltipPayload): void {
  if (!stat_tooltip) return;
  stat_tooltip.innerHTML = "";

  const title = document.createElement("div");
  title.className = "stat-tooltip-title";
  title.textContent = payload.name;
  stat_tooltip.appendChild(title);

  const type_line = document.createElement("div");
  type_line.className = "stat-tooltip-passive";
  type_line.textContent = `Type: ${payload.type.toUpperCase()}`;
  stat_tooltip.appendChild(type_line);

  const stats_grid = document.createElement("div");
  stats_grid.className = "stat-tooltip-grid";
  stats_grid.appendChild(
    tooltip_stat_row("ATK", payload.current.attack, payload.base.attack, payload.stages.attack, payload.totalPercent.attack)
  );
  stats_grid.appendChild(
    tooltip_stat_row("DEF", payload.current.defense, payload.base.defense, payload.stages.defense, payload.totalPercent.defense)
  );
  stats_grid.appendChild(
    tooltip_stat_row("DEX", payload.current.speed, payload.base.speed, payload.stages.speed, payload.totalPercent.speed)
  );
  stat_tooltip.appendChild(stats_grid);

  const moves_box = document.createElement("div");
  moves_box.className = "stat-tooltip-moves";
  const moves = payload.moves.slice(0, LOBBY_MOVE_SLOTS);
  while (moves.length < LOBBY_MOVE_SLOTS) {
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

function move_description(move_id: string): string {
  return MOVE_TOOLTIP_DESCRIPTIONS[move_id] ?? "Sem descricao disponivel.";
}

function clear_move_tooltip_delay(): void {
  if (move_tooltip_delay_timer === null) {
    return;
  }
  window.clearTimeout(move_tooltip_delay_timer);
  move_tooltip_delay_timer = null;
}

function position_move_tooltip(client_x: number, client_y: number): void {
  if (!move_tooltip) return;
  const offset = 14;
  const margin = 10;
  const rect = move_tooltip.getBoundingClientRect();
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

  move_tooltip.style.left = `${left}px`;
  move_tooltip.style.top = `${top}px`;
}

function open_move_tooltip(target: HTMLButtonElement): void {
  if (!move_tooltip) return;
  const move_id = target.dataset.moveId;
  if (!move_id) return;
  const label = target.dataset.moveLabel || MOVE_LABELS[move_id] || move_id;
  move_tooltip.innerHTML = "";
  const title = document.createElement("div");
  title.className = "move-tooltip-title";
  title.textContent = label;
  const desc = document.createElement("div");
  desc.className = "move-tooltip-desc";
  desc.textContent = move_description(move_id);
  move_tooltip.append(title, desc);
  move_tooltip_target = target;
  move_tooltip.classList.add("is-open");
  move_tooltip.setAttribute("aria-hidden", "false");
  position_move_tooltip(move_tooltip_mouse_x, move_tooltip_mouse_y);
}

function close_move_tooltip(): void {
  clear_move_tooltip_delay();
  move_tooltip_pending_target = null;
  move_tooltip_target = null;
  if (!move_tooltip) return;
  move_tooltip.classList.remove("is-open");
  move_tooltip.setAttribute("aria-hidden", "true");
}

function schedule_move_tooltip(target: HTMLButtonElement, event: MouseEvent): void {
  if (!match_started) {
    return;
  }
  const move_id = target.dataset.moveId;
  if (!move_id) {
    return;
  }
  move_tooltip_mouse_x = event.clientX;
  move_tooltip_mouse_y = event.clientY;
  move_tooltip_pending_target = target;
  clear_move_tooltip_delay();
  move_tooltip_delay_timer = window.setTimeout(() => {
    move_tooltip_delay_timer = null;
    if (move_tooltip_pending_target !== target) {
      return;
    }
    open_move_tooltip(target);
  }, MOVE_TOOLTIP_DELAY_MS);
}

function handle_move_button_hover_position(target: HTMLButtonElement, event: MouseEvent): void {
  move_tooltip_mouse_x = event.clientX;
  move_tooltip_mouse_y = event.clientY;
  if (move_tooltip_target === target) {
    position_move_tooltip(event.clientX, event.clientY);
  }
}

function bind_move_button_tooltip(target: HTMLButtonElement): void {
  target.addEventListener("mouseenter", (event) => {
    schedule_move_tooltip(target, event as MouseEvent);
  });
  target.addEventListener("mousemove", (event) => {
    handle_move_button_hover_position(target, event as MouseEvent);
  });
  target.addEventListener("mouseleave", () => {
    if (move_tooltip_pending_target === target) {
      move_tooltip_pending_target = null;
      clear_move_tooltip_delay();
    }
    if (move_tooltip_target === target) {
      close_move_tooltip();
    }
  });
  target.addEventListener("mousedown", () => {
    if (move_tooltip_target === target || move_tooltip_pending_target === target) {
      close_move_tooltip();
    }
  });
}

function append_log(line: string): void {
  append_line(log_list, compact_slot_labels(line));
}

function append_chat(line: string, class_name?: string): void {
  append_line(chat_messages, line, class_name);
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
  const create_participant_item = (name: string, meta: string): HTMLDivElement => {
    const item = document.createElement("div");
    item.className = "participant";
    const name_span = document.createElement("span");
    name_span.textContent = name;
    const meta_span = document.createElement("span");
    meta_span.className = "participant-meta";
    meta_span.textContent = meta;
    item.append(name_span, meta_span);
    return item;
  };
  for (const slot_id of PLAYER_SLOTS) {
    const name = state.players[slot_id];
    if (!name) continue;
    const meta = slot_id === "player1" ? "P1" : "P2";
    participants_list.appendChild(create_participant_item(name, meta));
  }
  const spectators = state.spectators.slice().sort((a, b) => a.localeCompare(b, undefined, { sensitivity: "base" }));
  for (const name of spectators) {
    participants_list.appendChild(create_participant_item(name, "spec"));
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

const profile = load_lobby_profile(profile_key, roster_by_id);
const LOBBY_DEFAULT_MOVES_RESTORE_MIGRATION_V1 = "vibi_showdown_migration_restore_defaults_v1";

function restore_starter_default_moves_once(): void {
  const migration_key = `${LOBBY_DEFAULT_MOVES_RESTORE_MIGRATION_V1}:${profile_key}`;
  try {
    if (localStorage.getItem(migration_key) === "1") {
      return;
    }
  } catch {}

  let changed = false;
  for (const monster_id of STARTER_MONSTER_IDS) {
    const spec = roster_by_id.get(monster_id);
    if (!spec) {
      continue;
    }
    const config = profile.monsters[monster_id];
    if (!config || !Array.isArray(config.moves)) {
      continue;
    }
    const moves = config.moves.slice(0, LOBBY_MOVE_SLOTS);
    while (moves.length < LOBBY_MOVE_SLOTS) {
      moves.push("none");
    }
    const all_none = moves.every((move_id) => move_id === "none");
    if (!all_none) {
      continue;
    }
    config.moves = default_lobby_moves_for_spec(spec, LOBBY_MOVE_SLOTS);
    changed = true;
  }

  if (changed) {
    save_lobby_profile(profile_key, profile);
  }
  try {
    localStorage.setItem(migration_key, "1");
  } catch {}
}

restore_starter_default_moves_once();

function save_profile(): void {
  save_lobby_profile(profile_key, profile);
}

function load_team_selection(): void {
  const loaded = load_lobby_team_selection(team_key, roster_by_id, is_lobby_enabled_monster, 3);
  selected.splice(0, selected.length, ...loaded);
}

function save_team_selection(): void {
  save_lobby_team_selection(team_key, selected);
}

function get_config(monster_id: string): MonsterConfig {
  return get_lobby_config({
    monster_id,
    roster_by_id,
    profile,
    profile_key,
    lobby_move_slots: LOBBY_MOVE_SLOTS
  });
}

function reset_profile_stats_to_defaults(): void {
  const changed = reset_lobby_profile_stats({
    profile,
    profile_key,
    roster,
    lobby_move_slots: LOBBY_MOVE_SLOTS
  });
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

function refresh_roster_tooltips(): void {
  const list = document.getElementById("roster-list");
  if (!list) {
    return;
  }
  const cards = list.querySelectorAll<HTMLElement>(".roster-card[data-monster-id]");
  for (const card of cards) {
    const monster_id = card.dataset.monsterId;
    if (!monster_id || !roster_by_id.has(monster_id)) {
      set_monster_tooltip(card, null);
      continue;
    }
    set_monster_tooltip(card, tooltip_from_config(monster_id));
  }
}

function refresh_lobby_tooltips(): void {
  update_slots();
  refresh_roster_tooltips();
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
  render_lobby_config({
    active_tab,
    moves_grid,
    stats_grid,
    roster_by_id,
    get_config,
    base_stats_from_spec,
    stats_from_base_level_ev,
    save_profile,
    clear_warning,
    show_warning,
    is_ready,
    match_started,
    lobby_move_slots: LOBBY_MOVE_SLOTS,
    move_labels: MOVE_LABELS,
    priority_move_ids: STARTER_DEFAULT_PRIORITY_MOVE_IDS,
    level_min: LEVEL_MIN,
    level_max: LEVEL_MAX,
    ev_per_stat_max: EV_PER_STAT_MAX,
    ev_total_max: EV_TOTAL_MAX,
    ev_total,
    calc_non_hp_stat,
    validate_ev_spread,
    refresh_lobby_tooltips,
    update_action_controls,
    rerender: render_config
  });
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
  if (!is_lobby_enabled_monster(id)) {
    show_warning("Monster desativado nesta fase.");
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
  for (const entry of roster.filter((mon) => is_lobby_enabled_monster(mon.id))) {
    const card = document.createElement("div");
    const is_selected = selected.includes(entry.id);
    const is_disabled = (!is_selected && selected.length >= 3) || (is_ready && !match_started);
    const tooltip = tooltip_from_config(entry.id);
    card.className = `roster-card${is_selected ? " active" : ""}${is_disabled ? " disabled" : ""}`;
    card.dataset.monsterId = entry.id;
    set_monster_tooltip(card, tooltip);
    card.innerHTML = `
      <div class="sprite" style="width:24px;height:24px;">
        <img src="${icon_path(entry.id)}" alt="${entry.name}" />
      </div>
      <div>
        <h4>${entry.name}</h4>
        <p>${monster_type_description(entry.type)}</p>
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

function set_bench_slot(
  slot: BenchSlotEl,
  mon: MonsterState | null,
  index: number | null,
  enabled: boolean,
  blocked_switch: boolean = false,
  tooltip: MonsterTooltipPayload | null = null
): void {
  if (!mon || index === null || index < 0) {
    slot.btn.classList.add("empty");
    slot.btn.classList.remove("blocked-switch");
    slot.btn.disabled = true;
    slot.btn.removeAttribute("data-index");
    set_monster_tooltip(slot.btn, null);
    slot.img.removeAttribute("src");
    slot.img.alt = "";
    slot.img.style.display = "none";
    return;
  }
  slot.btn.classList.remove("empty");
  slot.btn.classList.toggle("blocked-switch", blocked_switch);
  slot.btn.dataset.index = `${index}`;
  set_monster_tooltip(slot.btn, tooltip);
  slot.btn.disabled = !enabled;
  slot.img.src = icon_path(mon.id);
  slot.img.alt = monster_label(mon.id);
  slot.img.style.display = "";
}

function arena_trap_remaining_turns(state: GameState, target_slot: PlayerSlot): number {
  const until_turn = state.arenaTrapUntilTurn?.[target_slot] ?? 0;
  if (until_turn <= 0 || until_turn < state.turn) {
    return 0;
  }
  return until_turn - state.turn + 1;
}

function is_slot_arena_trapped_for_ui(state: GameState, target_slot: PlayerSlot): boolean {
  if (state.pendingSwitch?.[target_slot]) {
    return false;
  }
  const until_turn = state.arenaTrapUntilTurn?.[target_slot] ?? 0;
  return until_turn > 0 && until_turn >= state.turn;
}

type UiSwitchBlockReason = "arena trapped" | "immobilize" | "confuse" | "taunt";

function switch_block_reason_for_ui(state: GameState, target_slot: PlayerSlot): UiSwitchBlockReason | null {
  if (is_slot_arena_trapped_for_ui(state, target_slot)) {
    return "arena trapped";
  }
  if ((state.tauntUntilTurn?.[target_slot] ?? 0) >= state.turn || has_active_effect(state, target_slot, "taunt")) {
    return "taunt";
  }
  if (has_active_effect(state, target_slot, "confuse")) {
    return "confuse";
  }
  if (has_active_effect(state, target_slot, "immobilize")) {
    return "immobilize";
  }
  return null;
}

type UiRunBlockReason = "nocaute" | "sleep" | "silence" | "taunt";

function has_available_switch_target_for_ui(state: GameState, target_slot: PlayerSlot): boolean {
  const player = state.players[target_slot];
  return player.team.some((mon, index) => index !== player.activeIndex && mon.hp > 0);
}

function run_block_reason_for_ui(state: GameState, target_slot: PlayerSlot): UiRunBlockReason | null {
  if (has_available_switch_target_for_ui(state, target_slot) && has_active_effect(state, target_slot, "nocaute")) {
    return "nocaute";
  }
  if (has_active_effect(state, target_slot, "sleep")) {
    return "sleep";
  }
  if (has_active_effect(state, target_slot, "silence")) {
    return "silence";
  }
  if ((state.tauntUntilTurn?.[target_slot] ?? 0) >= state.turn || has_active_effect(state, target_slot, "taunt")) {
    return "taunt";
  }
  return null;
}

function run_block_label_for_ui(reason: UiRunBlockReason): string {
  if (reason === "nocaute") return "nocaute";
  if (reason === "sleep") return "sleep";
  if (reason === "silence") return "silence";
  return "taunt";
}

function update_bench(state: GameState, viewer_slot: PlayerSlot): void {
  const me = state.players[viewer_slot];
  const enemy_slot = viewer_slot === "player1" ? "player2" : "player1";
  const opp = state.players[enemy_slot];
  const my_bench = me.team.map((_, idx) => idx).filter((idx) => idx !== me.activeIndex);
  const opp_bench = opp.team.map((_, idx) => idx).filter((idx) => idx !== opp.activeIndex);
  const my_switch_blocked_reason = switch_block_reason_for_ui(state, viewer_slot);
  const my_switch_blocked = my_switch_blocked_reason !== null;
  const can_switch =
    !!slot &&
    slot === viewer_slot &&
    match_started &&
    !is_spectator &&
    (!!has_pending_switch() || current_turn > 0) &&
    !my_switch_blocked;

  player_bench_slots.forEach((slot_el, i) => {
    const idx = my_bench[i] ?? null;
    const mon = idx !== null ? me.team[idx] : null;
    const tooltip = mon && idx !== null ? tooltip_from_state(state, viewer_slot, mon, { previewSwitchIn: true }) : null;
    set_bench_slot(slot_el, mon, idx, can_switch, my_switch_blocked, tooltip);
  });
  enemy_bench_slots.forEach((slot_el, i) => {
    const idx = opp_bench[i] ?? null;
    const mon = idx !== null ? opp.team[idx] : null;
    const tooltip = mon && idx !== null ? tooltip_from_state(state, enemy_slot, mon, { previewSwitchIn: true }) : null;
    set_bench_slot(slot_el, mon, idx, false, false, tooltip);
  });
}

function update_action_controls(): void {
  const has_team = selected.length === 3;
  const pending_switch = has_pending_switch();
  const controls_disabled = !match_started || !slot || is_spectator || current_turn <= 0 || pending_switch;
  if (!has_team) {
    move_buttons.forEach((btn, index) => {
      btn.textContent = `Move ${index + 1}`;
      btn.disabled = true;
      btn.classList.remove("selected-intent");
      delete btn.dataset.moveId;
      delete btn.dataset.moveLabel;
    });
    if (run_btn) {
      run_btn.textContent = "4. Run(+10% M.SPE)";
      run_btn.disabled = true;
      run_btn.classList.remove("selected-intent");
      delete run_btn.dataset.moveId;
      delete run_btn.dataset.moveLabel;
    }
    close_move_tooltip();
    return;
  }

  const active_id = selected[0];
  const config = get_config(active_id);
  let guard_on_cooldown = false;
  let active_moves = config.moves;
  let self_switch_has_target = true;
  const run_blocked_reason = latest_state && slot ? run_block_reason_for_ui(latest_state, slot) : null;
  if (latest_state && slot) {
    const player_state = latest_state.players[slot];
    const fallback_active = player_state.team[player_state.activeIndex];
    const preview_active_index =
      pending_switch && has_forced_switch_target_for_current_turn() && typeof forced_switch_target_index === "number"
        ? forced_switch_target_index
        : player_state.activeIndex;
    const preview_active =
      pending_switch && has_forced_switch_target_for_current_turn() && typeof forced_switch_target_index === "number"
        ? player_state.team[forced_switch_target_index] ?? fallback_active
        : fallback_active;
    guard_on_cooldown = Math.max(preview_active.protectCooldownTurns, preview_active.endureCooldownTurns) > 0;
    active_moves = preview_active.chosenMoves;
    self_switch_has_target = player_state.team.some((mon, index) => index !== preview_active_index && mon.hp > 0);
  }
  move_buttons.forEach((btn, index) => {
    const move = active_moves[index] ?? "none";
    const label = MOVE_LABELS[move] || move;
    btn.dataset.moveId = move;
    btn.dataset.moveLabel = label;
    if (move === "protect" && guard_on_cooldown) {
      btn.textContent = `${index + 1}. Protect (cooldown)`;
      btn.disabled = true;
    } else if (move === "endure" && guard_on_cooldown) {
      btn.textContent = `${index + 1}. Endure (cooldown)`;
      btn.disabled = true;
    } else if (move === "switch_sovietico" && !self_switch_has_target) {
      btn.textContent = `${index + 1}. ${label} (no switch target)`;
      btn.disabled = true;
    } else {
      btn.textContent = `${index + 1}. ${label}`;
      btn.disabled = controls_disabled;
    }
    const is_selected_move =
      selected_intent_turn === current_turn && selected_intent?.action === "use_move" && selected_intent.moveIndex === index;
    btn.classList.toggle("selected-intent", is_selected_move && !btn.disabled);
  });
  if (run_btn) {
    const run_disabled = controls_disabled || !!run_blocked_reason;
    run_btn.dataset.moveId = "run";
    run_btn.dataset.moveLabel = "Run";
    if (run_blocked_reason) {
      run_btn.textContent = `4. Run(+10% M.SPE) (${run_block_label_for_ui(run_blocked_reason)})`;
    } else {
      run_btn.textContent = "4. Run(+10% M.SPE)";
    }
    run_btn.disabled = run_disabled;
    const is_selected_run = selected_intent_turn === current_turn && selected_intent?.action === "run";
    run_btn.classList.toggle("selected-intent", is_selected_run && !run_btn.disabled);
  }
  const show_surrender = match_started && !!slot && !is_spectator;
  surrender_btn.classList.toggle("hidden", !show_surrender);
  surrender_btn.disabled = !show_surrender;
  if (latest_state) {
    const viewer_slot = current_viewer_slot();
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

function has_pending_forced_choice_for_current_turn(): boolean {
  return has_pending_switch() && !has_forced_switch_target_for_current_turn();
}

function is_switch_modal_lock_active(): boolean {
  return switch_modal_mode === "forced" && has_pending_forced_choice_for_current_turn();
}

function current_active_monster_for_intent(): MonsterState | null {
  if (!latest_state || !slot) {
    return null;
  }
  const player_state = latest_state.players[slot];
  const fallback_active = player_state.team[player_state.activeIndex] ?? null;
  if (!fallback_active) {
    return null;
  }
  if (has_pending_switch() && has_forced_switch_target_for_current_turn() && typeof forced_switch_target_index === "number") {
    return player_state.team[forced_switch_target_index] ?? fallback_active;
  }
  return fallback_active;
}

function active_move_id_for_index(move_index: number): string | null {
  const active = current_active_monster_for_intent();
  if (!active) {
    return null;
  }
  return active.chosenMoves[move_index] ?? null;
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

function send_run_intent(): void {
  if (!post_turn_intent({ action: "run" })) {
    return;
  }
  const was_selected = selected_intent_turn === current_turn && selected_intent !== null;
  selected_intent = { action: "run" };
  selected_intent_turn = current_turn;
  update_action_controls();
  append_log(was_selected ? "intent updated (Run)" : "intent sent (Run)");
}

function send_move_intent(moveIndex: number): void {
  const move_id = active_move_id_for_index(moveIndex);
  if (move_id === "run") {
    send_run_intent();
    return;
  }
  if (!post_turn_intent({ action: "use_move", moveIndex })) {
    return;
  }
  const was_selected = selected_intent_turn === current_turn && selected_intent !== null;
  selected_intent = { action: "use_move", moveIndex };
  selected_intent_turn = current_turn;
  update_action_controls();
  if (move_id === "switch_sovietico") {
    append_log(was_selected ? "intent updated (Switch Sovietico armed)" : "intent sent (Switch Sovietico armed)");
    return;
  }
  append_log(was_selected ? "intent updated" : "intent sent");
}

function send_switch_intent(targetIndex: number): void {
  if (has_pending_switch()) {
    forced_switch_target_index = targetIndex;
    forced_switch_target_turn = current_turn;
    if (relay_runtime.is_server_managed() && !try_post({ $: "forced_switch", targetIndex, player_id })) {
      clear_forced_switch_target();
      return;
    }

    let lock_intent_sent = false;
    if (latest_state && slot) {
      const forced_preview = apply_forced_switch(latest_state, slot, targetIndex);
      if (!forced_preview.error) {
        const lock_intent = relay_runtime.default_intent(forced_preview.state, slot);
        if (post_turn_intent(lock_intent)) {
          selected_intent = lock_intent;
          selected_intent_turn = current_turn;
          lock_intent_sent = true;
        }
      }
    }

    close_switch_modal();
    append_log(
      lock_intent_sent
        ? "replacement selected; action locked (no move this turn)"
        : "replacement selected (no move this turn)"
    );
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

function close_switch_modal(force: boolean = false): void {
  if (!force && is_switch_modal_lock_active()) {
    return;
  }
  switch_modal_mode = "intent";
  switch_close.disabled = false;
  if (switch_title) {
    switch_title.textContent = "Switch Pokemon";
  }
  switch_modal.classList.remove("open");
}

function open_switch_modal(mode: SwitchModalMode = "intent"): void {
  if (!latest_state || !slot) return;
  if (mode === "intent" && !can_send_intent()) return;
  close_move_tooltip();
  switch_modal_mode = mode;
  if (switch_title) {
    if (mode === "forced") {
      switch_title.textContent = "Forced Switch";
    } else {
      switch_title.textContent = "Switch Pokemon";
    }
  }
  const lock_modal = mode === "forced" && has_pending_forced_choice_for_current_turn();
  switch_close.disabled = lock_modal;
  switch_options.classList.add("switch-options-sovietico");
  switch_options.innerHTML = "";
  const player = latest_state.players[slot];
  const active_index = player.activeIndex;
  const options = player.team
    .map((mon, index) => ({ mon, index }))
    .filter((entry) => entry.index !== active_index && entry.mon.hp > 0);
  if (options.length === 0) {
    const msg = document.createElement("div");
    msg.textContent = "No available swaps";
    msg.style.fontSize = "11px";
    msg.style.color = "#9aa5b1";
    switch_options.appendChild(msg);
  } else {
    for (const entry of options) {
      const button = document.createElement("button");
      button.type = "button";
      button.classList.add("switch-sovietico-option");
      button.disabled = false;
      const icon = document.createElement("img");
      icon.src = icon_path(entry.mon.id);
      icon.alt = monster_label(entry.mon.id);
      const label = document.createElement("span");
      label.textContent = monster_label(entry.mon.id);
      button.append(icon, label);
      button.addEventListener("click", () => {
        send_switch_intent(entry.index);
      });
      switch_options.appendChild(button);
    }
  }
  switch_modal.classList.add("open");
}

function build_team_selection(): TeamSelection | null {
  const result = build_lobby_team_selection({
    selected,
    roster_by_id,
    lobby_move_slots: LOBBY_MOVE_SLOTS,
    is_lobby_enabled_monster,
    monster_label,
    get_config
  });
  if (!result.team) {
    if (result.warning) {
      show_warning(result.warning);
    }
    return null;
  }
  clear_warning();
  save_profile();
  return result.team;
}

function send_ready(next_ready: boolean): void {
  if (next_ready && match_started) {
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

function update_ready_ui(should_refresh_lobby: boolean = true): void {
  if (status_ready) {
    status_ready.textContent = is_ready ? "ready" : "not ready";
    status_ready.className = `status-pill ${is_ready ? "ok" : "off"}`;
  }
  ready_btn.textContent = is_ready ? "Unready" : "Ready";
  ready_btn.disabled = match_started;
  if (reset_status_btn) {
    reset_status_btn.disabled = match_started || is_ready;
  }
  update_turn_duration_input();
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
  if (!should_refresh_lobby) {
    return;
  }
  render_roster();
  render_tabs();
  render_config();
}

function update_opponent_ui(opponent_ready: boolean, opponent_name: string | null): void {
  if (!status_opponent) return;
  status_opponent.textContent = opponent_ready ? "ready" : opponent_name ? "waiting" : "offline";
  status_opponent.className = `status-pill ${opponent_ready ? "ok" : opponent_name ? "warn" : "off"}`;
}

function show_match_end(state: GameState): void {
  if (!match_end) return;
  const winner = state.winner;
  const end_reason = state.endReason;
  const slot_label = (slot_id: PlayerSlot): string => (slot_id === "player1" ? "P1" : "P2");

  if (end_reason === "mSPE_escape") {
    const evaded = Array.isArray(state.mSPESlots)
      ? state.mSPESlots.filter((slot_id): slot_id is PlayerSlot => slot_id === "player1" || slot_id === "player2")
      : [];
    if (evaded.length >= 2) {
      match_end_title.textContent = "Double Escape";
      match_end_sub.textContent = "Both players escaped technically.";
    } else if (evaded.length === 1) {
      const escaped = evaded[0];
      match_end_title.textContent = slot && slot === escaped ? "Escape" : "Match ended";
      match_end_sub.textContent = `${slot_label(escaped)} escaped technically.`;
    } else {
      match_end_title.textContent = "Match ended";
      match_end_sub.textContent = "Technical escape.";
    }
    match_end.classList.add("open");
    return;
  }

  const is_winner = winner && slot === winner;
  match_end_title.textContent = is_winner ? "Victory" : "Defeat";
  if (!winner) {
    match_end_title.textContent = "Match ended";
  }
  if (winner) {
    match_end_sub.textContent = `${winner} wins the match.`;
  } else if (end_reason === "turn_limit") {
    match_end_sub.textContent = "Match finished by turn limit.";
  } else {
    match_end_sub.textContent = "Match finished.";
  }
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
  close_switch_modal(true);
  close_move_tooltip();
  match_end.classList.remove("open");
  prematch.style.display = "";
  document.body.classList.add("prematch-open");
  status_turn.textContent = "0";
  update_rps_status(null);
  update_deadline();
  update_ready_ui();
  update_action_controls();
}

function handle_turn_start(data: { turn: number; deadline_at: number }): void {
  current_turn = data.turn;
  deadline_at = data.deadline_at;
  selected_intent = null;
  selected_intent_turn = 0;
  clear_forced_switch_target();
  close_move_tooltip();
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
    if (entry.type === "clear_body_blocked") {
      append_chat(entry.summary, "log-clear-body");
      continue;
    }
    if (entry.type === "passive_trigger") {
      const data = entry.data as { passive?: string } | undefined;
      if (data?.passive === "type_def_armor_stack") {
        append_chat(entry.summary, "log-clear-body");
        continue;
      }
    }
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

function effect_chip(label: string, kind: "seeded" | "drain" | "buff" | "debuff"): HTMLSpanElement {
  const chip = document.createElement("span");
  chip.className = `effect-chip ${kind}`;
  const dot = document.createElement("span");
  dot.className = "effect-dot";
  chip.appendChild(dot);
  chip.append(label);
  return chip;
}

type EffectChipKind = "seeded" | "drain" | "buff" | "debuff";
type EffectChipDef = { label: string; kind: EffectChipKind };
type TagCategory = "control" | "stat" | "sustain" | "curse" | "misc";
type TagChip = {
  id: string;
  label: string;
  kind: EffectChipKind;
  category: TagCategory;
  order: number;
};
type TagContext = {
  state: GameState;
  slotId: PlayerSlot;
  opponentSlot: PlayerSlot;
  statAggregates: UiStatAggregate[];
  myCurses: ActiveCurseUi[];
  enemyCurses: ActiveCurseUi[];
};
type ActiveEffectUi = { id: string; remainingTurns: number };
type EffectTagBuilder = (effect: ActiveEffectUi, ctx: TagContext) => TagChip[];
type CurseTagBuilder = (curse: ActiveCurseUi, ctx: TagContext) => TagChip[];

const EFFECT_UI_LABELS: Record<string, string> = {
  confuse: "Confuse",
  sleep: "Sleep",
  stun: "Stun",
  happiness: "Happiness",
  taunt: "Taunt",
  frustration: "Frustration",
  nocaute: "Nocaute",
  immobilize: "Immobilize",
  weakness: "Weakness",
  deterioration: "Deterioration",
  paralyse: "Paralyse",
  silence: "Silence"
};
const CURSE_UI_LABELS: Record<string, string> = {
  madness: "Madness",
  leech_seed: "Leech Seed",
  destiny_bond: "Destiny Bond",
  endure: "Endure"
};

function stat_short_label(stat: TooltipStatKey): string {
  if (stat === "attack") return "ATK";
  if (stat === "defense") return "DEF";
  return "DEX";
}

function format_delta_percent(delta: number): string {
  return `${delta >= 0 ? "+" : ""}${delta}%`;
}

function format_stage_delta(stage_delta: number): string {
  return `${stage_delta >= 0 ? "+" : ""}${stage_delta} stg`;
}

function effect_kind_for_stat_aggregate(entry: UiStatAggregate): EffectChipKind {
  if (entry.totalStageDelta !== 0) {
    return entry.totalStageDelta > 0 ? "buff" : "debuff";
  }
  if (entry.totalDeltaPercent !== 0) {
    return entry.totalDeltaPercent > 0 ? "buff" : "debuff";
  }
  return "buff";
}

type ActiveCurseUi = { id: string; sourceSlot: PlayerSlot | null; stacks: number; appliedTurn?: number };

function active_curses_for_slot(state: GameState, slot_id: PlayerSlot): ActiveCurseUi[] {
  const input = state.activeCursesBySlot?.[slot_id];
  if (!Array.isArray(input)) {
    return [];
  }
  return input.map((row) => ({
    id: typeof row.id === "string" ? row.id : "unknown",
    sourceSlot: row.sourceSlot === "player1" || row.sourceSlot === "player2" ? row.sourceSlot : null,
    stacks: typeof row.stacks === "number" && Number.isFinite(row.stacks) ? Math.max(1, Math.floor(row.stacks)) : 1,
    appliedTurn:
      typeof row.appliedTurn === "number" && Number.isFinite(row.appliedTurn) ? Math.floor(row.appliedTurn) : undefined
  }));
}

function active_effects_for_slot(state: GameState, slot_id: PlayerSlot): ActiveEffectUi[] {
  const input = state.activeEffectsBySlot?.[slot_id];
  if (!Array.isArray(input)) {
    return [];
  }
  const normalized: ActiveEffectUi[] = [];
  for (const row of input) {
    const id = typeof row?.id === "string" && row.id.trim().length > 0 ? row.id : "unknown";
    const remaining_turns =
      typeof row?.remainingTurns === "number" && Number.isFinite(row.remainingTurns)
        ? Math.max(1, Math.floor(row.remainingTurns))
        : 1;
    normalized.push({ id, remainingTurns: remaining_turns });
  }
  return normalized;
}

function tag_category_order(category: TagCategory): number {
  if (category === "control") return 100;
  if (category === "stat") return 200;
  if (category === "sustain") return 300;
  if (category === "curse") return 400;
  return 500;
}

function dedupe_and_sort_tag_chips(chips: TagChip[]): TagChip[] {
  const unique = new Map<string, TagChip>();
  for (const chip of chips) {
    const key = `${chip.id}|${chip.label}|${chip.kind}|${chip.category}|${chip.order}`;
    if (!unique.has(key)) {
      unique.set(key, chip);
    }
  }
  const sorted = Array.from(unique.values());
  sorted.sort((left, right) => {
    const category_diff = tag_category_order(left.category) - tag_category_order(right.category);
    if (category_diff !== 0) {
      return category_diff;
    }
    if (left.order !== right.order) {
      return left.order - right.order;
    }
    return left.label.localeCompare(right.label);
  });
  return sorted;
}

function stat_chip_label(entry: UiStatAggregate): string {
  const parts: string[] = [stat_short_label(entry.stat)];
  if (entry.totalStageDelta !== 0) {
    parts.push(`stg ${entry.totalStageDelta >= 0 ? "+" : ""}${entry.totalStageDelta}`);
  }
  if (entry.totalDeltaPercent !== 0) {
    parts.push(format_delta_percent(entry.totalDeltaPercent));
  }
  return parts.join(" | ");
}

function build_state_relation_chips(ctx: TagContext): TagChip[] {
  const chips: TagChip[] = [];
  const seeded = ctx.myCurses.some((curse) => curse.id === "leech_seed");
  const draining_enemy = ctx.enemyCurses.some((curse) => curse.id === "leech_seed" && curse.sourceSlot === ctx.slotId);
  if (seeded) {
    chips.push({
      id: "state_seeded",
      label: "Seeded",
      kind: "seeded",
      category: "curse",
      order: 400
    });
  }
  if (draining_enemy) {
    chips.push({
      id: "state_drain",
      label: "Leech+",
      kind: "drain",
      category: "sustain",
      order: 320
    });
  }
  return chips;
}

function build_passive_stat_chips(ctx: TagContext): TagChip[] {
  const chips: TagChip[] = [];
  const armor_stacks = Math.max(0, ctx.state.typePassiveArmorStacks?.[ctx.slotId] ?? 0);
  const regen_stacks = Math.max(0, ctx.state.typePassiveRegenStacks?.[ctx.slotId] ?? 0);
  const arena_trapped = is_slot_arena_trapped_for_ui(ctx.state, ctx.slotId);
  const arena_trap_turns = arena_trap_remaining_turns(ctx.state, ctx.slotId);

  if (armor_stacks > 0) {
    chips.push({
      id: "passive_armor",
      label: `Armor | +${armor_stacks * 10}%`,
      kind: "buff",
      category: "stat",
      order: 210
    });
  }
  if (regen_stacks > 0) {
    chips.push({
      id: "passive_regen",
      label: `Regen | +${regen_stacks * 5}/turn`,
      kind: "buff",
      category: "sustain",
      order: 330
    });
  }
  if (arena_trapped) {
    chips.push({
      id: "debuff_arena_trap",
      label: `Arena Trap | ${arena_trap_turns}t sem troca`,
      kind: "debuff",
      category: "control",
      order: 110
    });
  }
  return chips;
}

function build_stat_aggregate_chips(ctx: TagContext): TagChip[] {
  const chips: TagChip[] = [];
  for (const entry of ctx.statAggregates) {
    if (entry.totalStageDelta === 0 && entry.totalDeltaPercent === 0) {
      continue;
    }
    chips.push({
      id: `stat_${entry.stat}`,
      label: stat_chip_label(entry),
      kind: effect_kind_for_stat_aggregate(entry),
      category: "stat",
      order: entry.stat === "attack" ? 201 : entry.stat === "defense" ? 202 : 203
    });
  }
  return chips;
}

function effect_default_tag_builder(effect: ActiveEffectUi): TagChip[] {
  const label = EFFECT_UI_LABELS[effect.id] ?? effect.id;
  return [
    {
      id: `effect_${effect.id}`,
      label: `${label} | ${effect.remainingTurns}t`,
      kind: "debuff",
      category: "control",
      order: 120
    }
  ];
}

function effect_rejuvenation_tag_builder(_: ActiveEffectUi, ctx: TagContext): TagChip[] {
  const raw_stack = ctx.state.rejuvenationStacks?.[ctx.slotId];
  const stack = typeof raw_stack === "number" && Number.isFinite(raw_stack) ? Math.max(1, Math.floor(raw_stack)) : 1;
  const regen_per_turn = stack * REJUVENATION_REGEN_PER_STACK;
  return [
    {
      id: "effect_rejuvenation",
      label: `Rejuv | +${regen_per_turn} HP/t`,
      kind: "buff",
      category: "sustain",
      order: 310
    }
  ];
}

const EFFECT_TAG_BUILDERS: Record<string, EffectTagBuilder> = {
  rejuvenation: effect_rejuvenation_tag_builder
};

function build_effect_chips(ctx: TagContext): TagChip[] {
  const chips: TagChip[] = [];
  const effects = active_effects_for_slot(ctx.state, ctx.slotId);
  for (const effect of effects) {
    const builder = EFFECT_TAG_BUILDERS[effect.id] ?? effect_default_tag_builder;
    chips.push(...builder(effect, ctx));
  }
  return chips;
}

function curse_default_tag_builder(curse: ActiveCurseUi): TagChip[] {
  const label = CURSE_UI_LABELS[curse.id] ?? curse.id;
  const suffix = curse.stacks > 1 ? ` | x${curse.stacks}` : "";
  return [
    {
      id: `curse_${curse.id}`,
      label: `${label}${suffix}`,
      kind: "debuff",
      category: "curse",
      order: 410
    }
  ];
}

function curse_leech_seed_tag_builder(curse: ActiveCurseUi, ctx: TagContext): TagChip[] {
  const max_hp = Math.max(1, Math.floor(ctx.state.players[ctx.slotId]?.sharedHpMax ?? 1));
  const stacks = Math.max(1, Math.floor(curse.stacks));
  const hp_per_turn = Math.max(0, Math.floor(max_hp / LEECH_SEED_HP_DIVISOR) * stacks);
  return [
    {
      id: "curse_leech_seed",
      label: `Leech Seed | -${hp_per_turn} HP/t`,
      kind: "debuff",
      category: "curse",
      order: 405
    }
  ];
}

function curse_sekyps_tag_builder(curse: ActiveCurseUi, ctx: TagContext): TagChip[] {
  const stacks = Math.max(1, Math.floor(curse.stacks));
  const state_turn = Number.isFinite(ctx.state.turn) ? Math.floor(ctx.state.turn) : 0;
  const applied_this_turn = typeof curse.appliedTurn === "number" && curse.appliedTurn === state_turn;
  const ticking_stacks = applied_this_turn ? Math.max(0, stacks - 1) : stacks;
  const hp_per_turn = Math.max(0, ticking_stacks * SEKYPS_DAMAGE_PER_STACK_UI);
  return [
    {
      id: "curse_sekyps",
      label: `Sekyps | -${hp_per_turn} HP/t`,
      kind: "debuff",
      category: "curse",
      order: 406
    }
  ];
}

const CURSE_TAG_BUILDERS: Record<string, CurseTagBuilder> = {
  leech_seed: curse_leech_seed_tag_builder,
  sekyps: curse_sekyps_tag_builder
};

function build_curse_chips(ctx: TagContext): TagChip[] {
  const chips: TagChip[] = [];
  for (const curse of ctx.myCurses) {
    const builder = CURSE_TAG_BUILDERS[curse.id] ?? curse_default_tag_builder;
    chips.push(...builder(curse, ctx));
  }
  return chips;
}

function build_tag_chips(ctx: TagContext): TagChip[] {
  return dedupe_and_sort_tag_chips([
    ...build_state_relation_chips(ctx),
    ...build_passive_stat_chips(ctx),
    ...build_stat_aggregate_chips(ctx),
    ...build_effect_chips(ctx),
    ...build_curse_chips(ctx)
  ]);
}

function effect_chips_for_slot(state: GameState, slot_id: PlayerSlot, opponent_slot: PlayerSlot): EffectChipDef[] {
  const buff_entries = active_buff_debuffs_for_slot(state, slot_id);
  const stat_aggregates = stat_aggregates_from_entries(buff_entries);
  const my_curses = active_curses_for_slot(state, slot_id);
  const enemy_curses = active_curses_for_slot(state, opponent_slot);
  const tag_chips = build_tag_chips({
    state,
    slotId: slot_id,
    opponentSlot: opponent_slot,
    statAggregates: stat_aggregates,
    myCurses: my_curses,
    enemyCurses: enemy_curses
  });
  return tag_chips.map((chip) => ({
    label: chip.label,
    kind: chip.kind
  }));
}

function render_effect_chip_list(container: HTMLDivElement | null, chips: EffectChipDef[]): void {
  if (!container) {
    return;
  }
  container.innerHTML = "";
  for (const chip of chips) {
    container.appendChild(effect_chip(chip.label, chip.kind));
  }
}

function render_effects(
  state: GameState,
  player_slot: PlayerSlot,
  enemy_slot: PlayerSlot
): void {
  const player_seeded = active_curses_for_slot(state, player_slot).some((curse) => curse.id === "leech_seed");
  const enemy_seeded = active_curses_for_slot(state, enemy_slot).some((curse) => curse.id === "leech_seed");

  player_sprite_wrap.classList.toggle("seeded", player_seeded);
  enemy_sprite_wrap.classList.toggle("seeded", enemy_seeded);
  render_effect_chip_list(player_effects, effect_chips_for_slot(state, player_slot, enemy_slot));
  render_effect_chip_list(enemy_effects, effect_chips_for_slot(state, enemy_slot, player_slot));
}

type SidePanelId = "player" | "enemy";

function panel_hp_percent(mon: MonsterState): number {
  return Math.max(0, Math.min(1, mon.hp / mon.maxHp)) * 100;
}

function update_side_panel(
  side: SidePanelId,
  state: GameState,
  slot_id: PlayerSlot,
  skip_meta: boolean,
  skip_bar: boolean,
  force_hidden: boolean = false
): void {
  const player = state.players[slot_id];
  const active = player.team[player.activeIndex];
  const pending_replacement = !!state.pendingSwitch?.[slot_id] && active.hp <= 0;
  const title = side === "player" ? player_title : enemy_title;
  const meta = side === "player" ? player_meta : enemy_meta;
  const hp_bar = side === "player" ? player_hp : enemy_hp;
  const sprite = side === "player" ? player_sprite : enemy_sprite;
  const sprite_wrap = side === "player" ? player_sprite_wrap : enemy_sprite_wrap;

  title.textContent = side === "player" ? player.name || player_name : player.name || "Opponent";
  if (!skip_meta) {
    meta.textContent = `Lv ${active.level} · HP ${active.hp}/${active.maxHp}`;
  }
  if (!skip_bar) {
    hp_bar.style.width = `${panel_hp_percent(active)}%`;
  }
  if (pending_replacement || force_hidden) {
    sprite.removeAttribute("src");
    sprite.alt = "";
    sprite.style.visibility = "hidden";
    set_monster_tooltip(sprite_wrap, null);
    return;
  }
  sprite.src = icon_path(active.id);
  sprite.alt = monster_label(active.id);
  sprite.style.visibility = "";
  set_monster_tooltip(sprite_wrap, tooltip_from_state(state, slot_id, active));
}

function update_panels(
  state: GameState,
  opts?: { skipMeta?: { player?: boolean; enemy?: boolean }; skipBar?: { player?: boolean; enemy?: boolean } }
): void {
  const viewer_slot = current_viewer_slot();
  if (!viewer_slot) return;
  const enemy_slot = viewer_slot === "player1" ? "player2" : "player1";
  const hide_panels_for_pending_choice =
    !!slot &&
    !is_spectator &&
    state.pendingSwitch?.[slot] &&
    !(typeof forced_switch_target_index === "number" && forced_switch_target_turn === current_turn);
  update_side_panel(
    "player",
    state,
    viewer_slot,
    !!opts?.skipMeta?.player,
    !!opts?.skipBar?.player,
    hide_panels_for_pending_choice
  );
  update_side_panel(
    "enemy",
    state,
    enemy_slot,
    !!opts?.skipMeta?.enemy,
    !!opts?.skipBar?.enemy,
    hide_panels_for_pending_choice
  );
  render_effects(state, viewer_slot, enemy_slot);
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
  const duration = 340;
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
    if (
      entry.type !== "damage" &&
      entry.type !== "recoil" &&
      entry.type !== "leech_drain" &&
      entry.type !== "spikes_trigger"
    ) {
      continue;
    }
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
    } else if (entry.type === "spikes_trigger") {
      defender_slot = payload.targetSlot ?? payload.slot;
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
  }, 760);
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

function trigger_shield_on(el: HTMLElement): void {
  el.classList.remove("shield-hit");
  el.classList.remove("shield-on");
  void el.offsetWidth;
  el.classList.add("shield-on");
}

function trigger_shield_hit(el: HTMLElement, duration: number): void {
  if (!el.classList.contains("shield-on")) {
    el.classList.add("shield-on");
  }
  el.classList.remove("shield-hit");
  void el.offsetWidth;
  el.classList.add("shield-hit");
  window.setTimeout(() => {
    el.classList.remove("shield-hit");
    el.classList.remove("shield-on");
  }, duration);
}

function handle_state(data: { state: GameState; log: EventLog[] }): void {
  const prev_state = latest_state;
  clear_animation_timers();
  const viewer_slot = current_viewer_slot();
  const steps = prev_state ? build_visual_steps(prev_state, data.log, viewer_slot) : [];
  const hit_sides = new Set<"player" | "enemy">(
    steps.filter((step) => step.kind === "damage").map((step) => step.defenderSide)
  );
  latest_state = data.state;
  update_rps_status(data.state);
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
    const min_step_duration = 500;
    const step_gap = 70;
    let cursor = 0;
    for (const step of steps) {
      const base_duration =
        step.kind === "damage" ? 720 : step.kind === "shield_hit" ? 760 : step.kind === "shield_on" ? 620 : 560;
      const duration = Math.max(min_step_duration, base_duration);
      schedule_animation(() => {
        if (step.kind === "damage") {
          const attacker_wrap = sprite_wrap(step.attackerSide);
          const defender_wrap = sprite_wrap(step.defenderSide);
          trigger_class(attacker_wrap, "jump", 420);
          trigger_class(defender_wrap, "hit", 520);
          const bar = step.defenderSide === "player" ? player_hp : enemy_hp;
          const from_percent = Math.max(0, Math.min(1, step.from / step.maxHp)) * 100;
          const to_percent = Math.max(0, Math.min(1, step.to / step.maxHp)) * 100;
          animate_hp_bar(bar, from_percent, to_percent);
          animate_hp_text(step.defenderSide, step.level, step.from, step.to, step.maxHp, 220);
          return;
        }
        if (step.kind === "shield_on") {
          const wrap = sprite_wrap(step.side);
          trigger_shield_on(wrap);
          return;
        }
        if (step.kind === "shield_hit") {
          const attacker_wrap = sprite_wrap(step.attackerSide);
          const defender_wrap = sprite_wrap(step.defenderSide);
          trigger_class(attacker_wrap, "jump", 420);
          trigger_shield_hit(defender_wrap, 820);
          return;
        }
        if (step.kind === "heal") {
          const wrap = sprite_wrap(step.side);
          trigger_class(wrap, "heal", 520);
        }
      }, cursor);
      cursor += duration + step_gap;
    }
    schedule_animation(() => {
      update_panels(data.state);
    }, cursor + 60);
  } else {
    update_panels(data.state);
  }
  if (data.state.status === "ended") {
    close_switch_modal(true);
  } else {
    close_switch_modal();
  }
  if (data.log.length) {
    log_events(data.log);
  }
  update_action_controls();
  if (data.state.status === "ended" && prev_state?.status !== "ended") {
    append_match_end_marker();
  }
  if (data.state.status === "ended") {
    show_match_end(data.state);
  }
}

function handle_post(message: { data: RoomPost }): void {
  const data = message.data;
  switch (data.$) {
    case "assign":
      slot = data.slot;
      is_spectator = false;
      update_spec_view_controls();
      set_player_name(data.slot, data.name);
      if (status_slot) status_slot.textContent = data.slot === "player1" ? "P1" : "P2";
      if (status_conn) status_conn.textContent = "synced";
      player_meta.textContent = `Slot ${data.slot === "player1" ? "P1" : "P2"}`;
      append_log(`assigned ${data.slot}`);
      append_chat(`${data.name} assigned to ${data.slot === "player1" ? "P1" : "P2"}`);
      update_rps_status(latest_state);
      if (latest_state) {
        update_panels(latest_state);
        update_action_controls();
      }
      render_participants();
      return;
    case "ready_state": {
      const previous = last_ready_snapshot ?? { player1: false, player2: false };
      last_ready_snapshot = { ...data.ready };
      const was_ready = is_ready;
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
      update_ready_ui(was_ready !== is_ready);
      render_participants();
      return;
    }
    case "turn_config":
      if (match_started) {
        return;
      }
      apply_turn_duration_seconds(data.turnDurationSeconds);
      return;
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
      spectator_viewer_slot = "player1";
      update_spec_view_controls();
      is_ready = false;
      opponent_ready = false;
      opponent_name = null;
      add_spectator(data.name);
      if (status_slot) status_slot.textContent = "spectator";
      player_meta.textContent = "Spectator";
      update_rps_status(latest_state);
      if (latest_state) {
        update_panels(latest_state);
        update_action_controls();
      }
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
  bind_move_button_tooltip(btn);
});

if (spec_view_p1) {
  spec_view_p1.addEventListener("click", () => {
    set_spectator_viewer_slot("player1");
  });
}

if (spec_view_p2) {
  spec_view_p2.addEventListener("click", () => {
    set_spectator_viewer_slot("player2");
  });
}

if (run_btn) {
  run_btn.addEventListener("click", () => {
    send_run_intent();
  });
  bind_move_button_tooltip(run_btn);
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

if (turn_seconds_input) {
  const commit_turn_seconds = (): void => {
    if (match_started || is_ready) {
      update_turn_duration_input();
      return;
    }
    send_turn_duration_config(Number(turn_seconds_input.value));
  };
  turn_seconds_input.addEventListener("change", commit_turn_seconds);
  turn_seconds_input.addEventListener("blur", commit_turn_seconds);
}

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
  if (slot && is_ready) {
    send_ready(false);
    // Optimistic unlock: local lobby editing is available immediately.
    is_ready = false;
  }
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
  close_move_tooltip();
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
  if (!join_sent || relay_runtime.is_server_managed()) {
    return;
  }
  try_post({ $: "join", name: player_name, player_id });
}, RELAY_JOIN_HEARTBEAT_MS);

setInterval(() => {
  if (relay_runtime.is_server_managed()) {
    return;
  }
  relay_runtime.prune_inactive(Date.now());
}, 5000);

load_team_selection();
render_roster();
render_tabs();
render_config();
update_roster_count();
update_slots();
update_turn_duration_input();
update_action_controls();
update_rps_status(null);
render_participants();
update_spec_view_controls();

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
      join_sent = true;
    }
  }
});
