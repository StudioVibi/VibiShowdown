import type {
  ChatPost,
  EventLog,
  EVSpread,
  ForcedSwitchPost,
  GameState,
  IntentLockedPost,
  IntentPost,
  JoinPost,
  MonsterConfig,
  MonsterState,
  ParticipantsPost,
  PlayerIntent,
  PlayerSlot,
  PlayerState,
  ReadyPost,
  ReadyStatePost,
  RoomPost,
  SpectatorPost,
  StatePost,
  Stats,
  SurrenderPost,
  SurrenderRequestPost,
  TeamSelection,
  TurnConfigPost,
  TurnStartPost
} from "./shared.ts";

type UnknownRecord = Record<string, unknown>;

type RawInfoPostEnvelope = {
  $: "info_post";
  room: string;
  index: number;
  server_time: number;
  client_time: number;
  name?: string;
  data: unknown;
};

export type RoomInfoPostEnvelope = Omit<RawInfoPostEnvelope, "data"> & { data: RoomPost };

function is_record(value: unknown): value is UnknownRecord {
  return typeof value === "object" && value !== null;
}

function is_string(value: unknown): value is string {
  return typeof value === "string";
}

function is_number(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value);
}

function is_integer(value: unknown): value is number {
  return Number.isInteger(value);
}

function is_non_negative_integer(value: unknown): value is number {
  return is_integer(value) && value >= 0;
}

function is_player_slot(value: unknown): value is PlayerSlot {
  return value === "player1" || value === "player2";
}

function is_monster_type(value: unknown): boolean {
  return value === "buf" || value === "def" || value === "atk";
}

function is_string_array(value: unknown): value is string[] {
  return Array.isArray(value) && value.every(is_string);
}

function optional_string(value: unknown): boolean {
  return value === undefined || is_string(value);
}

function optional_non_negative_integer(value: unknown): boolean {
  return value === undefined || is_non_negative_integer(value);
}

function is_stats(value: unknown): value is Stats {
  if (!is_record(value)) return false;
  return (
    is_number(value.level) &&
    is_number(value.maxHp) &&
    is_number(value.attack) &&
    is_number(value.defense) &&
    is_number(value.speed)
  );
}

function is_ev_spread(value: unknown): value is EVSpread {
  if (!is_record(value)) return false;
  return is_number(value.hp) && is_number(value.atk) && is_number(value.def) && is_number(value.spe);
}

function is_monster_config(value: unknown): value is MonsterConfig {
  if (!is_record(value)) return false;
  return (
    is_string(value.id) &&
    is_string_array(value.moves) &&
    is_string(value.passive) &&
    is_monster_type(value.type) &&
    is_stats(value.stats) &&
    is_ev_spread(value.ev)
  );
}

function is_team_selection(value: unknown): value is TeamSelection {
  if (!is_record(value)) return false;
  if (!Array.isArray(value.monsters) || !value.monsters.every(is_monster_config)) return false;
  return is_non_negative_integer(value.activeIndex);
}

function is_player_intent(value: unknown): value is PlayerIntent {
  if (!is_record(value) || !is_string(value.action)) {
    return false;
  }
  if (value.action === "switch") {
    return is_non_negative_integer(value.targetIndex);
  }
  if (value.action === "run") {
    return true;
  }
  if (value.action === "use_move") {
    if (!is_non_negative_integer(value.moveIndex)) {
      return false;
    }
    return optional_non_negative_integer(value.selfSwitchTargetIndex);
  }
  return false;
}

function is_join_post(value: unknown): value is JoinPost {
  if (!is_record(value) || value.$ !== "join") return false;
  return is_string(value.name) && optional_string(value.player_id) && optional_string(value.token);
}

function is_assign_post(value: unknown): value is RoomPost {
  if (!is_record(value) || value.$ !== "assign") return false;
  return is_player_slot(value.slot) && is_string(value.token) && is_string(value.name);
}

function is_spectator_post(value: unknown): value is SpectatorPost {
  if (!is_record(value) || value.$ !== "spectator") return false;
  return is_string(value.name);
}

function is_chat_post(value: unknown): value is ChatPost {
  if (!is_record(value) || value.$ !== "chat") return false;
  return is_string(value.message) && is_string(value.from) && optional_string(value.player_id);
}

function is_players_record(value: unknown): value is Record<PlayerSlot, string | null> {
  if (!is_record(value)) return false;
  const p1 = value.player1;
  const p2 = value.player2;
  const p1_ok = p1 === null || is_string(p1);
  const p2_ok = p2 === null || is_string(p2);
  return p1_ok && p2_ok;
}

function is_participants_post(value: unknown): value is ParticipantsPost {
  if (!is_record(value) || value.$ !== "participants") return false;
  return is_players_record(value.players) && is_string_array(value.spectators);
}

function is_ready_post(value: unknown): value is ReadyPost {
  if (!is_record(value) || value.$ !== "ready") return false;
  if (typeof value.ready !== "boolean") return false;
  if (!optional_string(value.player_id)) return false;
  if (value.team === undefined) return true;
  return is_team_selection(value.team);
}

function is_ready_record(value: unknown): value is Record<PlayerSlot, boolean> {
  if (!is_record(value)) return false;
  return typeof value.player1 === "boolean" && typeof value.player2 === "boolean";
}

function is_ready_state_post(value: unknown): value is ReadyStatePost {
  if (!is_record(value) || value.$ !== "ready_state") return false;
  if (!is_ready_record(value.ready) || !is_players_record(value.names)) {
    return false;
  }
  if (value.order === undefined) {
    return true;
  }
  return Array.isArray(value.order) && value.order.every(is_player_slot);
}

function is_intent_post(value: unknown): value is IntentPost {
  if (!is_record(value) || value.$ !== "intent") return false;
  return (
    is_non_negative_integer(value.turn) &&
    is_player_intent(value.intent) &&
    optional_non_negative_integer(value.forcedSwitchTargetIndex) &&
    optional_string(value.player_id)
  );
}

function is_forced_switch_post(value: unknown): value is ForcedSwitchPost {
  if (!is_record(value) || value.$ !== "forced_switch") return false;
  return is_non_negative_integer(value.targetIndex) && optional_string(value.player_id);
}

function is_intent_locked_post(value: unknown): value is IntentLockedPost {
  if (!is_record(value) || value.$ !== "intent_locked") return false;
  return is_player_slot(value.slot) && is_non_negative_integer(value.turn);
}

function is_intents_record(value: unknown): value is Record<PlayerSlot, boolean> {
  if (!is_record(value)) return false;
  return typeof value.player1 === "boolean" && typeof value.player2 === "boolean";
}

function is_turn_start_post(value: unknown): value is TurnStartPost {
  if (!is_record(value) || value.$ !== "turn_start") return false;
  return is_non_negative_integer(value.turn) && is_number(value.deadline_at) && is_intents_record(value.intents);
}

function is_turn_config_post(value: unknown): value is TurnConfigPost {
  if (!is_record(value) || value.$ !== "turn_config") return false;
  return is_number(value.turnDurationSeconds) && optional_string(value.player_id);
}

function is_monster_state(value: unknown): value is MonsterState {
  if (!is_record(value)) return false;
  return (
    is_string(value.id) &&
    is_string(value.name) &&
    is_monster_type(value.type) &&
    is_number(value.hp) &&
    is_number(value.maxHp) &&
    is_number(value.mSPE) &&
    is_number(value.level) &&
    is_number(value.baseAttack) &&
    is_number(value.baseDefense) &&
    is_number(value.baseSpeed) &&
    is_number(value.attack) &&
    is_number(value.attackStage) &&
    is_number(value.defense) &&
    is_number(value.defenseStage) &&
    is_number(value.speed) &&
    is_number(value.speedStage) &&
    typeof value.agilityBoostActive === "boolean" &&
    typeof value.endureSpeedBoostActive === "boolean" &&
    typeof value.bellyDrumActive === "boolean" &&
    typeof value.screechDebuffActive === "boolean" &&
    is_string_array(value.possibleMoves) &&
    is_string_array(value.possiblePassives) &&
    is_string_array(value.chosenMoves) &&
    is_string(value.chosenPassive) &&
    typeof value.protectActiveThisTurn === "boolean" &&
    typeof value.specialProtectActiveThisTurn === "boolean" &&
    typeof value.endureActiveThisTurn === "boolean" &&
    typeof value.baitActiveThisTurn === "boolean" &&
    is_number(value.protectCooldownTurns) &&
    is_number(value.specialProtectCooldownTurns) &&
    is_number(value.endureCooldownTurns)
  );
}

function is_player_state(value: unknown): value is PlayerState {
  if (!is_record(value)) return false;
  if (!is_player_slot(value.slot)) return false;
  if (!is_string(value.name)) return false;
  if (!is_number(value.sharedHp) || !is_number(value.sharedHpMax) || !is_number(value.sharedMSPE)) return false;
  if (!Array.isArray(value.team) || value.team.length === 0 || !value.team.every(is_monster_state)) return false;
  if (!is_non_negative_integer(value.activeIndex)) return false;
  return value.activeIndex < value.team.length;
}

function is_players_state(value: unknown): value is Record<PlayerSlot, PlayerState> {
  if (!is_record(value)) return false;
  return is_player_state(value.player1) && is_player_state(value.player2);
}

function is_game_state_status(value: unknown): boolean {
  return value === "setup" || value === "running" || value === "ended";
}

function is_event_log(value: unknown): value is EventLog {
  if (!is_record(value)) return false;
  if (!is_string(value.type) || !is_integer(value.turn) || !is_string(value.summary)) return false;
  if (value.phase !== undefined && !is_string(value.phase)) return false;
  if (value.data !== undefined && !is_record(value.data)) return false;
  return true;
}

function is_state_post(value: unknown): value is StatePost {
  if (!is_record(value) || value.$ !== "state") return false;
  if (!is_non_negative_integer(value.turn)) return false;
  if (!is_record(value.state)) return false;
  if (!is_integer(value.state.turn)) return false;
  if (!is_game_state_status(value.state.status)) return false;
  if (!is_players_state(value.state.players)) return false;
  if (!Array.isArray(value.log) || !value.log.every(is_event_log)) return false;
  return true;
}

function is_surrender_post(value: unknown): value is SurrenderPost {
  if (!is_record(value) || value.$ !== "surrender") return false;
  return is_non_negative_integer(value.turn) && is_player_slot(value.loser) && is_player_slot(value.winner);
}

function is_surrender_request_post(value: unknown): value is SurrenderRequestPost {
  if (!is_record(value) || value.$ !== "surrender") return false;
  return optional_string(value.player_id);
}

function is_error_post(value: unknown): boolean {
  if (!is_record(value) || value.$ !== "error") return false;
  return is_string(value.message) && optional_string(value.code);
}

export function is_room_post(value: unknown): value is RoomPost {
  if (!is_record(value) || !is_string(value.$)) {
    return false;
  }
  switch (value.$) {
    case "join":
      return is_join_post(value);
    case "assign":
      return is_assign_post(value);
    case "spectator":
      return is_spectator_post(value);
    case "chat":
      return is_chat_post(value);
    case "participants":
      return is_participants_post(value);
    case "ready":
      return is_ready_post(value);
    case "ready_state":
      return is_ready_state_post(value);
    case "intent":
      return is_intent_post(value);
    case "forced_switch":
      return is_forced_switch_post(value);
    case "intent_locked":
      return is_intent_locked_post(value);
    case "turn_start":
      return is_turn_start_post(value);
    case "turn_config":
      return is_turn_config_post(value);
    case "state":
      return is_state_post(value);
    case "surrender":
      return is_surrender_post(value) || is_surrender_request_post(value);
    case "error":
      return is_error_post(value);
    default:
      return false;
  }
}

export function parse_room_post_json(raw: unknown): RoomPost | null {
  if (!is_string(raw)) {
    return null;
  }
  try {
    const parsed = JSON.parse(raw) as unknown;
    return is_room_post(parsed) ? parsed : null;
  } catch {
    return null;
  }
}

export function is_raw_info_post_envelope(value: unknown): value is RawInfoPostEnvelope {
  if (!is_record(value) || value.$ !== "info_post") {
    return false;
  }
  if (!is_string(value.room)) return false;
  if (!is_integer(value.index)) return false;
  if (!is_number(value.server_time) || !is_number(value.client_time)) return false;
  if (!optional_string(value.name)) return false;
  return "data" in value;
}

export function is_room_info_post_envelope(value: unknown): value is RoomInfoPostEnvelope {
  if (!is_raw_info_post_envelope(value)) {
    return false;
  }
  return is_room_post(value.data);
}

export function is_game_state(value: unknown): value is GameState {
  if (!is_record(value)) {
    return false;
  }
  if (!is_integer(value.turn)) {
    return false;
  }
  if (!is_game_state_status(value.status)) {
    return false;
  }
  return is_players_state(value.players);
}
