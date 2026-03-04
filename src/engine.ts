import {
  BASE_TURN_LIMIT,
  SHARED_MSPE_START,
  SHARED_HP_START,
} from "./shared.ts";
import type {
  ActiveBuffDebuffState,
  ActiveCurseState,
  ActiveEffectState,
  ActiveHealBuffState,
  BuffDebuffStat,
  MSPETelemetry,
  PendingSwitchReason,
  EVSpread,
  EventLog,
  GameState,
  MatchEndReason,
  MonsterType,
  MonsterState,
  MoveId,
  PlayerIntent,
  PlayerSlot,
  PlayerState,
  TeamSelection
} from "./shared.ts";
import { MONSTER_BY_ID } from "./data/mon.ts";
import { move_spec } from "./data/moves.ts";
import type {
  BuffDebuffCollateral,
  CurseCollateral,
  CurseCollateralId,
  EffectCollateral,
  EffectCollateralId,
  InstantCollateral
} from "./data/types.ts";
import { mul_div_ceil, mul_div_floor, mul_div_round, normalize_int } from "./int_math.ts";
import { LEVEL_MAX, LEVEL_MIN, calc_final_stats, scaled_level_for_formula, validate_ev_spread } from "./stats_calc.ts";

type Phase = {
  id: string;
  name: string;
  order: number;
  initiative: Array<keyof Pick<MonsterState, "speed" | "attack" | "hp" | "defense">>;
};

const INITIATIVE_DEFAULT: Phase["initiative"] = ["speed", "attack", "hp", "defense"];
const INITIATIVE_NONE: Phase["initiative"] = [];

const PHASES: Phase[] = [
  { id: "switch", name: "Switch", order: 0, initiative: INITIATIVE_DEFAULT },
  { id: "guard", name: "Guard", order: 1, initiative: INITIATIVE_DEFAULT },
  { id: "immune", name: "Immune", order: 1.5, initiative: INITIATIVE_DEFAULT },
  { id: "attack_01", name: "Attack 01", order: 2, initiative: INITIATIVE_DEFAULT },
  { id: "run", name: "Run", order: 3, initiative: INITIATIVE_NONE }
];

const END_PHASE_ID = "ending_turn";
const SLOT_ORDER = ["player1", "player2"] as const;
const END_TURN_EFFECT_ORDER = [
  "focus_punch",
  "rejuvenation_reactive",
  "wish",
  "leech_life",
  "rejuvenation_regen",
  "type_regen",
  "happiness_apply"
] as const;
type EndTurnEffectId = (typeof END_TURN_EFFECT_ORDER)[number];

const TAUNT_BLOCKED_MOVE_IDS = new Set([
  "none",
  "agility",
  "run",
  "switch_sovietico",
  "team_cure",
  "bait",
  "wish",
  "rejuvenation",
  "power",
  "spikes",
  "recover",
  "heal",
  "meditate",
  "belly_drum",
  "screech",
  "taunt",
  "pain_split",
  "leech_life",
  "sekyps",
  "hook"
]);

type Action =
  | { player: PlayerSlot; type: "switch"; phase: string; targetIndex: number }
  | { player: PlayerSlot; type: "run"; phase: string }
  | {
      player: PlayerSlot;
      type: "move";
      phase: string;
      moveId: MoveId;
      moveIndex: number;
    };

type MatchProgress = "continue" | "stop_turn" | "ended";

function is_attack_damage_phase(phase: string): boolean {
  return phase === "attack_01" || phase === "attack_02";
}

function is_special_protect_blocking_target_effect(
  state: GameState,
  source_slot: PlayerSlot,
  target_slot: PlayerSlot,
  source_phase_id: string
): boolean {
  if (source_slot === target_slot) {
    return false;
  }
  if (!is_attack_damage_phase(source_phase_id)) {
    return false;
  }
  const target = active_monster(state.players[target_slot]);
  return target.specialProtectActiveThisTurn === true;
}

function log_special_protect_block(
  state: GameState,
  log: EventLog[],
  source_slot: PlayerSlot,
  target_slot: PlayerSlot,
  source_move_id: string,
  source_phase_id: string,
  context: string
): void {
  const target = active_monster(state.players[target_slot]);
  log.push({
    type: "special_protect_blocked",
    turn: state.turn,
    phase: source_phase_id,
    summary: `${target.name} blocked ${source_move_id} ${context} with Special Protect`,
    data: {
      slot: source_slot,
      targetSlot: target_slot,
      move: source_move_id,
      context
    }
  });
}

const INITIATIVE_WITHOUT_SPEED: Phase["initiative"] = ["attack", "hp", "defense"];
const STAT_STAGE_MIN = -6;
const STAT_STAGE_MAX = 6;
const POWER_ATTACK_STAGE_PER_CAST = 1;
const MEDITATE_ATTACK_STAGE_PER_CAST = 2;
const TYPE_PASSIVE_ATK_TRUE_DAMAGE = 50;
const THROW_FIXED_OFFENSE_TERM = 90 * 90;
const TYPE_PASSIVE_DEF_ARMOR_STACK_MAX = 5;
const TYPE_PASSIVE_DEF_ARMOR_REDUCTION_PER_STACK_PERCENT = 10;
const TYPE_PASSIVE_BUF_REGEN_PER_STACK = 5;
const STAT_MULTIPLIER_MIN_PERCENT = 25;
const STAT_MULTIPLIER_MAX_PERCENT = 400;
const MSPE_VALUE_GOAL = 500;
const MSPE_GAP_GOAL_PERCENT = 33;
const RUN_MSPE_GAIN_PERCENT = 10;
const HOOK_RUN_MSPE_REDUCTION_PERCENT = 20;
const HOOK_EXPOSURE_INCOMING_DAMAGE_MULTIPLIER_PERCENT = 166;
const HOOK_SELF_MSPE_REDUCTION_PERCENT = 10;
const SEKYPS_DAMAGE_PER_STACK = 24;
const REJUVENATION_REGEN_FLAT_PER_STACK = 30;
const REJUVENATION_REGEN_STACK_MAX = 3;
const REJUVENATION_REGEN_FLAT_MAX = REJUVENATION_REGEN_FLAT_PER_STACK * REJUVENATION_REGEN_STACK_MAX;
const FERVOR_CHAIN_MAX = 2;
const FERVOR_MULTIPLIERS_100 = [50, 100, 200] as const;
const HAPPINESS_DURATION_AFTER_ENDING_APPLY = 2;
const TYPE_BUF_REGEN_HEAL_BUFF_ID = "type_buf_regen";
const REJUVENATION_REGEN_HEAL_BUFF_ID = "rejuvenation_regen";
const HEAL_MOVE_HEAL_BUFF_ID = "heal_move";
const RECOVER_MOVE_HEAL_BUFF_ID = "recover_move";
const EFFECT_IDS: readonly EffectCollateralId[] = [
  "confuse",
  "sleep",
  "stun",
  "taunt",
  "nocaute",
  "immobilize",
  "weakness",
  "deterioration",
  "paralyse",
  "silence",
  "rejuvenation"
] as const;
const EFFECT_ID_SET = new Set<string>(EFFECT_IDS);
const CURSE_IDS: readonly CurseCollateralId[] = [
  "madness",
  "frustration",
  "happiness",
  "leech_seed",
  "sekyps",
  "mirror",
  "destiny_bond",
  "endure"
] as const;
const CURSE_ID_SET = new Set<string>(CURSE_IDS);

const EFFECT_LABELS: Record<EffectCollateralId, string> = {
  confuse: "Confuse",
  sleep: "Sleep",
  stun: "Stun",
  taunt: "Taunt",
  nocaute: "Nocaute",
  immobilize: "Immobilize",
  weakness: "Weakness",
  deterioration: "Deterioration",
  paralyse: "Paralyse",
  silence: "Silence",
  rejuvenation: "Rejuvenation"
};
const CURSE_LABELS: Record<CurseCollateralId, string> = {
  madness: "Madness",
  frustration: "Frustration",
  happiness: "Happiness",
  leech_seed: "Leech Seed",
  sekyps: "Sekyps",
  mirror: "Mirror",
  destiny_bond: "Destiny Bond",
  endure: "Endure"
};

const NEGATIVE_STAT_EFFECT_ID_SET = new Set<EffectCollateralId>(["weakness", "deterioration", "paralyse"]);
const ATTACK_STAGE_BUFF_IDS = new Set<string>([
  "power_attack_up",
  "power_attack_stage_up",
  "meditate_attack_up",
  "belly_drum_attack_up"
]);
const POWER_ATTACK_STAGE_BUFF_IDS = new Set<string>(["power_attack_up", "power_attack_stage_up"]);

function clamp_stat_stage(value: number): number {
  return Math.max(STAT_STAGE_MIN, Math.min(STAT_STAGE_MAX, value));
}

function normalize_stat_stage(value: unknown, fallback: number): number {
  const raw = typeof value === "number" ? value : fallback;
  return clamp_stat_stage(normalize_int(raw, fallback, STAT_STAGE_MIN));
}

function stage_ratio(stage: number): { numerator: number; denominator: number } {
  const normalized = clamp_stat_stage(stage);
  if (normalized >= 0) {
    return { numerator: 2 + normalized, denominator: 2 };
  }
  return { numerator: 2, denominator: 2 - normalized };
}

function infer_stage_from_attack(current_attack: number, base_attack: number): number {
  if (!Number.isFinite(current_attack) || !Number.isFinite(base_attack) || base_attack <= 0) {
    return 0;
  }
  const inferred = Math.round((current_attack * 2) / base_attack - 2);
  return clamp_stat_stage(inferred);
}

function stat_value_from_stage(base_value: number, stage: number): number {
  const ratio = stage_ratio(stage);
  return Math.max(0, mul_div_round(base_value, ratio.numerator, ratio.denominator));
}

function attack_from_stage(base_attack: number, stage: number): number {
  return stat_value_from_stage(base_attack, stage);
}

function clamp_stat_multiplier_percent(total_percent: number): number {
  return Math.max(STAT_MULTIPLIER_MIN_PERCENT, Math.min(STAT_MULTIPLIER_MAX_PERCENT, total_percent));
}

function stat_multiplier_percent_from_delta(delta_percent: number): number {
  return clamp_stat_multiplier_percent(100 + delta_percent);
}

function stat_value_from_delta_percent(base_value: number, delta_percent: number): number {
  return Math.max(0, mul_div_round(base_value, stat_multiplier_percent_from_delta(delta_percent), 100));
}

function stat_value_from_delta_percent_and_stage(base_value: number, delta_percent: number, stage: number): number {
  const value_after_percent = stat_value_from_delta_percent(base_value, delta_percent);
  return stat_value_from_stage(value_after_percent, stage);
}

function normalize_fervor_chain(value: unknown): number {
  const raw = typeof value === "number" ? value : 0;
  return Math.max(0, Math.min(FERVOR_CHAIN_MAX, normalize_int(raw, 0, 0)));
}

function fervor_cast_streak_from_chain(chain: number): number {
  return Math.max(1, Math.min(FERVOR_MULTIPLIERS_100.length, normalize_fervor_chain(chain) + 1));
}

function fervor_multiplier100_for_chain(chain: number): number {
  const streak = fervor_cast_streak_from_chain(chain);
  return FERVOR_MULTIPLIERS_100[streak - 1] ?? FERVOR_MULTIPLIERS_100[0];
}

function entry_targets_monster(entry: ActiveBuffDebuffState, monster_id: string): boolean {
  return typeof entry.targetMonsterId !== "string" || entry.targetMonsterId.length === 0 || entry.targetMonsterId === monster_id;
}

function buff_debuff_entries_for_monster(state: GameState, slot: PlayerSlot, monster_id: string): ActiveBuffDebuffState[] {
  return buff_debuff_list(state, slot).filter((entry) => entry_targets_monster(entry, monster_id));
}

function power_attack_stage_bonus_from_entries(entries: readonly ActiveBuffDebuffState[]): number {
  let bonus = 0;
  for (const entry of entries) {
    if (entry.stat !== "attack") {
      continue;
    }
    if (!POWER_ATTACK_STAGE_BUFF_IDS.has(entry.id)) {
      continue;
    }
    bonus += POWER_ATTACK_STAGE_PER_CAST;
  }
  return bonus;
}

function intrinsic_attack_stage_for_monster(monster: MonsterState): number {
  return normalize_stat_stage(monster.attackStage, 0);
}

function local_attack_stage_without_mirror(state: GameState, slot: PlayerSlot, monster: MonsterState): number {
  const intrinsic_stage = intrinsic_attack_stage_for_monster(monster);
  const power_bonus = power_attack_stage_bonus_from_entries(buff_debuff_entries_for_monster(state, slot, monster.id));
  return clamp_stat_stage(intrinsic_stage + power_bonus);
}

function mirror_source_slot_for_target(state: GameState, target_slot: PlayerSlot): PlayerSlot | null {
  for (const curse of curse_list(state, target_slot)) {
    if (curse.id !== "mirror") {
      continue;
    }
    if (curse.sourceSlot === "player1" || curse.sourceSlot === "player2") {
      return curse.sourceSlot;
    }
  }
  return null;
}

function effective_attack_stage_for_monster(state: GameState, slot: PlayerSlot, monster: MonsterState): number {
  const mirror_source_slot = mirror_source_slot_for_target(state, slot);
  if (mirror_source_slot) {
    const source_monster = active_monster(state.players[mirror_source_slot]);
    return local_attack_stage_without_mirror(state, mirror_source_slot, source_monster);
  }
  return local_attack_stage_without_mirror(state, slot, monster);
}

function total_delta_percent_from_buff_debuffs(
  state: GameState,
  slot: PlayerSlot,
  stat: BuffDebuffStat,
  monster_id?: string
): number {
  const resolved_monster_id = monster_id ?? active_monster(state.players[slot]).id;
  let total = 0;
  for (const entry of buff_debuff_entries_for_monster(state, slot, resolved_monster_id)) {
    if (entry.stat !== stat) {
      continue;
    }
    if (stat === "attack" && ATTACK_STAGE_BUFF_IDS.has(entry.id)) {
      continue;
    }
    total += entry.deltaPercent;
  }
  return total;
}

function refresh_active_monster_stats_for_slot(state: GameState, slot: PlayerSlot): void {
  const monster = active_monster(state.players[slot]);
  const entries = buff_debuff_entries_for_monster(state, slot, monster.id);
  const attack_delta = total_delta_percent_from_buff_debuffs(state, slot, "attack", monster.id);
  const defense_delta = total_delta_percent_from_buff_debuffs(state, slot, "defense", monster.id);
  const speed_delta = total_delta_percent_from_buff_debuffs(state, slot, "speed", monster.id);
  const attack_stage = intrinsic_attack_stage_for_monster(monster);
  const effective_attack_stage = effective_attack_stage_for_monster(state, slot, monster);
  const defense_stage = normalize_stat_stage((monster as { defenseStage?: unknown }).defenseStage, 0);
  const speed_stage = normalize_stat_stage((monster as { speedStage?: unknown }).speedStage, 0);

  monster.attackStage = attack_stage;
  monster.defenseStage = defense_stage;
  monster.speedStage = speed_stage;
  monster.attack = stat_value_from_delta_percent_and_stage(monster.baseAttack, attack_delta, effective_attack_stage);
  monster.defense = stat_value_from_delta_percent_and_stage(monster.baseDefense, defense_delta, defense_stage);
  monster.speed = stat_value_from_delta_percent_and_stage(monster.baseSpeed, speed_delta, speed_stage);

  monster.agilityBoostActive = entries.some((entry) => entry.id === "agility_speed_up");
  monster.endureSpeedBoostActive = entries.some((entry) => entry.id === "endure_speed_up");
  monster.bellyDrumActive =
    effective_attack_stage >= STAT_STAGE_MAX || entries.some((entry) => entry.id === "belly_drum_attack_up");
  monster.screechDebuffActive = entries.some((entry) => entry.id === "screech_def_down");
}

function refresh_active_monster_stats(state: GameState): void {
  refresh_active_monster_stats_for_slot(state, "player1");
  refresh_active_monster_stats_for_slot(state, "player2");
}

function compare_action_initiative(state: GameState, phase: Phase, a: Action, b: Action): number {
  const a_slot = a.player;
  const b_slot = b.player;
  const a_active = active_monster(state.players[a.player]);
  const b_active = active_monster(state.players[b.player]);

  if (a.type === "move" && b.type === "move") {
    const a_quick = a.moveId === "quick_attack";
    const b_quick = b.moveId === "quick_attack";
    if (a_quick !== b_quick) {
      return a_quick ? 1 : -1;
    }
    if (a_quick && b_quick) {
      return compare_initiative(state, a_slot, b_slot, a_active, b_active, INITIATIVE_WITHOUT_SPEED);
    }
  }

  return compare_initiative(state, a_slot, b_slot, a_active, b_active, phase.initiative);
}

function action_type_order(action: Action): number {
  if (action.type === "move") return 0;
  if (action.type === "run") return 1;
  return 2;
}

function compare_actions_for_phase(state: GameState, phase: Phase, a: Action, b: Action): number {
  const cmp = compare_action_initiative(state, phase, a, b);
  if (cmp !== 0) {
    return -cmp;
  }
  if (a.player !== b.player) {
    return a.player === "player1" ? -1 : 1;
  }
  const type_cmp = action_type_order(a) - action_type_order(b);
  if (type_cmp !== 0) {
    return type_cmp;
  }
  if (a.type === "move" && b.type === "move") {
    return a.moveIndex - b.moveIndex;
  }
  if (a.type === "switch" && b.type === "switch") {
    return a.targetIndex - b.targetIndex;
  }
  return 0;
}

function clone_monster(monster: MonsterState): MonsterState {
  const base_attack = Number.isFinite(monster.baseAttack) ? monster.baseAttack : monster.attack;
  const base_defense = Number.isFinite(monster.baseDefense) ? monster.baseDefense : monster.defense;
  const base_speed = Number.isFinite(monster.baseSpeed) ? monster.baseSpeed : monster.speed;
  const attack_stage = normalize_stat_stage(
    monster.attackStage,
    infer_stage_from_attack(monster.attack, base_attack)
  );
  const defense_stage = normalize_stat_stage((monster as { defenseStage?: unknown }).defenseStage, 0);
  const speed_stage = normalize_stat_stage((monster as { speedStage?: unknown }).speedStage, 0);
  const attack_value = Number.isFinite(monster.attack) ? normalize_int(monster.attack, base_attack, 0) : base_attack;
  const defense_value = Number.isFinite(monster.defense) ? normalize_int(monster.defense, base_defense, 0) : base_defense;
  const speed_value = Number.isFinite(monster.speed) ? normalize_int(monster.speed, base_speed, 0) : base_speed;
  return {
    id: monster.id,
    name: monster.name,
    type: monster.type,
    hp: monster.hp,
    maxHp: monster.maxHp,
    mSPE: Math.max(0, normalize_int(monster.mSPE, SHARED_MSPE_START, 0)),
    level: monster.level,
    baseAttack: base_attack,
    baseDefense: base_defense,
    baseSpeed: base_speed,
    attack: attack_value,
    attackStage: attack_stage,
    defense: defense_value,
    defenseStage: defense_stage,
    speed: speed_value,
    speedStage: speed_stage,
    agilityBoostActive: !!monster.agilityBoostActive,
    endureSpeedBoostActive: !!monster.endureSpeedBoostActive,
    bellyDrumActive: !!monster.bellyDrumActive,
    screechDebuffActive: !!monster.screechDebuffActive,
    possibleMoves: monster.possibleMoves.slice(),
    possiblePassives: monster.possiblePassives.slice(),
    chosenMoves: monster.chosenMoves.slice(),
    chosenPassive: monster.chosenPassive,
    protectActiveThisTurn: monster.protectActiveThisTurn,
    specialProtectActiveThisTurn: !!monster.specialProtectActiveThisTurn,
    endureActiveThisTurn: monster.endureActiveThisTurn,
    baitActiveThisTurn: !!monster.baitActiveThisTurn,
    protectCooldownTurns: monster.protectCooldownTurns,
    specialProtectCooldownTurns: Math.max(0, normalize_int(monster.specialProtectCooldownTurns, 0, 0)),
    endureCooldownTurns: monster.endureCooldownTurns
  };
}

function empty_slot_record<T>(player1: T, player2: T): Record<PlayerSlot, T> {
  return { player1, player2 };
}

function empty_pending(): Record<PlayerSlot, boolean> {
  return empty_slot_record(false, false);
}

function empty_pending_switch_reason(): Record<PlayerSlot, PendingSwitchReason> {
  return empty_slot_record<PendingSwitchReason>("none", "none");
}

function empty_pending_switch_resolved_this_turn(): Record<PlayerSlot, boolean> {
  return empty_slot_record(false, false);
}

function empty_rps_score(): Record<PlayerSlot, number> {
  return empty_slot_record(0, 0);
}

function empty_type_passive_armor_stacks(): Record<PlayerSlot, number> {
  return empty_slot_record(0, 0);
}

function empty_type_passive_regen_stacks(): Record<PlayerSlot, number> {
  return empty_slot_record(0, 0);
}

function empty_rejuvenation_stacks(): Record<PlayerSlot, number> {
  return empty_slot_record(0, 0);
}

function empty_rejuvenation_start_turn(): Record<PlayerSlot, number> {
  return empty_slot_record(0, 0);
}

function empty_fervor_chain_by_slot(): Record<PlayerSlot, number> {
  return empty_slot_record(0, 0);
}

function empty_pending_wish(): Record<PlayerSlot, number | null> {
  return empty_slot_record<number | null>(null, null);
}

function empty_taunt_until_turn(): Record<PlayerSlot, number> {
  return empty_slot_record(0, 0);
}

function empty_active_effects(): Record<PlayerSlot, ActiveEffectState[]> {
  return empty_slot_record([], []);
}

function empty_active_buff_debuffs(): Record<PlayerSlot, ActiveBuffDebuffState[]> {
  return empty_slot_record([], []);
}

function empty_active_heal_buffs(): Record<PlayerSlot, ActiveHealBuffState[]> {
  return empty_slot_record([], []);
}

function empty_last_move_index(): Record<PlayerSlot, number | null> {
  return empty_slot_record<number | null>(null, null);
}

function empty_mSPE_telemetry(): Record<PlayerSlot, MSPETelemetry> {
  const empty_entry = (): MSPETelemetry => ({
    effectiveMSPE: SHARED_MSPE_START,
    mSPEGoal: MSPE_VALUE_GOAL,
    mSPEReady: false,
    gapPercent: 0,
    gapGoalPercent: MSPE_GAP_GOAL_PERCENT,
    gapReady: false,
    canMSPE: false
  });
  return empty_slot_record(empty_entry(), empty_entry());
}

function empty_active_curses(): Record<PlayerSlot, ActiveCurseState[]> {
  return empty_slot_record([], []);
}

function empty_arena_trap_until_turn(): Record<PlayerSlot, number> {
  return empty_slot_record(0, 0);
}

function empty_spikes_armed_by_target(): Record<PlayerSlot, boolean> {
  return empty_slot_record(false, false);
}

function effect_label(effect_id: string): string {
  if (effect_id in EFFECT_LABELS) {
    return EFFECT_LABELS[effect_id as EffectCollateralId];
  }
  return effect_id;
}

function curse_label(curse_id: string): string {
  if (curse_id in CURSE_LABELS) {
    return CURSE_LABELS[curse_id as CurseCollateralId];
  }
  return curse_id;
}

function normalize_active_effects(input: unknown): ActiveEffectState[] {
  if (!Array.isArray(input)) {
    return [];
  }
  const normalized: ActiveEffectState[] = [];
  for (const item of input) {
    if (!item || typeof item !== "object") {
      continue;
    }
    const row = item as { id?: unknown; remainingTurns?: unknown; appliedTurn?: unknown };
    if (typeof row.id !== "string" || !EFFECT_ID_SET.has(row.id)) {
      continue;
    }
    const remaining_raw = typeof row.remainingTurns === "number" ? row.remainingTurns : 1;
    const remaining = Math.max(1, normalize_int(remaining_raw, 1, 1));
    const applied_turn =
      typeof row.appliedTurn === "number" && Number.isFinite(row.appliedTurn)
        ? normalize_int(row.appliedTurn, 0, -1000000)
        : undefined;
    normalized.push({ id: row.id, remainingTurns: remaining, appliedTurn: applied_turn });
  }
  return normalized;
}

function normalize_active_curses(input: unknown): ActiveCurseState[] {
  if (!Array.isArray(input)) {
    return [];
  }
  const normalized: ActiveCurseState[] = [];
  for (const item of input) {
    if (!item || typeof item !== "object") {
      continue;
    }
    const row = item as {
      id?: unknown;
      sourceSlot?: unknown;
      stacks?: unknown;
      appliedTurn?: unknown;
      remainingTurns?: unknown;
    };
    if (typeof row.id !== "string" || !CURSE_ID_SET.has(row.id)) {
      continue;
    }
    const source_slot: PlayerSlot | null =
      row.sourceSlot === "player1" || row.sourceSlot === "player2" ? row.sourceSlot : null;
    const raw_stacks = typeof row.stacks === "number" ? row.stacks : 1;
    const stacks = Math.max(1, normalize_int(raw_stacks, 1, 1));
    const applied_turn =
      typeof row.appliedTurn === "number" && Number.isFinite(row.appliedTurn)
        ? normalize_int(row.appliedTurn, 0, -1000000)
        : undefined;
    const remaining_turns =
      typeof row.remainingTurns === "number" && Number.isFinite(row.remainingTurns)
        ? Math.max(1, normalize_int(row.remainingTurns, 1, 1))
        : undefined;
    normalized.push({
      id: row.id,
      sourceSlot: source_slot,
      stacks,
      appliedTurn: applied_turn,
      ...(typeof remaining_turns === "number" ? { remainingTurns: remaining_turns } : {})
    });
  }
  return normalized;
}

function is_buff_debuff_stat(value: unknown): value is BuffDebuffStat {
  return value === "attack" || value === "defense" || value === "speed";
}

function normalize_active_buff_debuffs(input: unknown): ActiveBuffDebuffState[] {
  if (!Array.isArray(input)) {
    return [];
  }
  const normalized: ActiveBuffDebuffState[] = [];
  for (const item of input) {
    if (!item || typeof item !== "object") {
      continue;
    }
    const row = item as {
      id?: unknown;
      sourceSlot?: unknown;
      source?: unknown;
      stat?: unknown;
      deltaPercent?: unknown;
      clearsOnSwitch?: unknown;
      targetMonsterId?: unknown;
    };
    if (typeof row.id !== "string" || row.id.trim().length === 0) {
      continue;
    }
    if (!is_buff_debuff_stat(row.stat)) {
      continue;
    }
    const source_slot: PlayerSlot | null =
      row.sourceSlot === "player1" || row.sourceSlot === "player2" ? row.sourceSlot : null;
    const source = typeof row.source === "string" && row.source.trim().length > 0 ? row.source : "unknown";
    const raw_delta = typeof row.deltaPercent === "number" ? row.deltaPercent : 0;
    const delta = normalize_int(raw_delta, 0, -1000000);
    const clears_on_switch = row.clearsOnSwitch === true;
    const target_monster_id =
      typeof row.targetMonsterId === "string" && row.targetMonsterId.trim().length > 0 ? row.targetMonsterId : undefined;
    normalized.push({
      id: row.id,
      sourceSlot: source_slot,
      source,
      stat: row.stat,
      deltaPercent: delta,
      clearsOnSwitch: clears_on_switch,
      ...(target_monster_id ? { targetMonsterId: target_monster_id } : {})
    });
  }
  return normalized;
}

function normalize_active_heal_buffs(input: unknown): ActiveHealBuffState[] {
  if (!Array.isArray(input)) {
    return [];
  }
  const normalized: ActiveHealBuffState[] = [];
  for (const item of input) {
    if (!item || typeof item !== "object") {
      continue;
    }
    const row = item as {
      id?: unknown;
      sourceSlot?: unknown;
      source?: unknown;
      healPerTurn?: unknown;
      growthPerTurn?: unknown;
      startTurn?: unknown;
      remainingTicks?: unknown;
      clearsOnSwitch?: unknown;
    };
    if (typeof row.id !== "string" || row.id.trim().length === 0) {
      continue;
    }
    const source_slot: PlayerSlot | null =
      row.sourceSlot === "player1" || row.sourceSlot === "player2" ? row.sourceSlot : null;
    const source = typeof row.source === "string" && row.source.trim().length > 0 ? row.source : "unknown";
    const heal_per_turn = Math.max(
      0,
      normalize_int(typeof row.healPerTurn === "number" ? row.healPerTurn : 0, 0, 0)
    );
    const growth_per_turn = normalize_int(
      typeof row.growthPerTurn === "number" ? row.growthPerTurn : 0,
      0,
      -1000000
    );
    const start_turn = Math.max(0, normalize_int(typeof row.startTurn === "number" ? row.startTurn : 0, 0, 0));
    const remaining_ticks_raw = row.remainingTicks;
    const remaining_ticks =
      typeof remaining_ticks_raw === "number" && Number.isFinite(remaining_ticks_raw)
        ? Math.max(1, normalize_int(remaining_ticks_raw, 1, 1))
        : null;
    const clears_on_switch = row.clearsOnSwitch === true;
    normalized.push({
      id: row.id,
      sourceSlot: source_slot,
      source,
      healPerTurn: heal_per_turn,
      growthPerTurn: growth_per_turn,
      startTurn: start_turn,
      remainingTicks: remaining_ticks,
      clearsOnSwitch: clears_on_switch
    });
  }
  return normalized;
}

function effect_list(state: GameState, slot: PlayerSlot): ActiveEffectState[] {
  return state.activeEffectsBySlot?.[slot] ?? [];
}

function curse_list(state: GameState, slot: PlayerSlot): ActiveCurseState[] {
  return state.activeCursesBySlot?.[slot] ?? [];
}

function buff_debuff_list(state: GameState, slot: PlayerSlot): ActiveBuffDebuffState[] {
  return state.activeBuffDebuffsBySlot?.[slot] ?? [];
}

function heal_buff_list(state: GameState, slot: PlayerSlot): ActiveHealBuffState[] {
  return state.activeHealBuffsBySlot?.[slot] ?? [];
}

function effect_state(state: GameState, slot: PlayerSlot, effect_id: EffectCollateralId): ActiveEffectState | null {
  for (const effect of effect_list(state, slot)) {
    if (effect.id === effect_id) {
      return effect;
    }
  }
  return null;
}

function curse_state(state: GameState, slot: PlayerSlot, curse_id: CurseCollateralId): ActiveCurseState | null {
  for (const curse of curse_list(state, slot)) {
    if (curse.id === curse_id) {
      return curse;
    }
  }
  return null;
}

function heal_buff_state(state: GameState, slot: PlayerSlot, heal_buff_id: string): ActiveHealBuffState | null {
  for (const buff of heal_buff_list(state, slot)) {
    if (buff.id === heal_buff_id) {
      return buff;
    }
  }
  return null;
}

function has_effect(state: GameState, slot: PlayerSlot, effect_id: EffectCollateralId): boolean {
  return !!effect_state(state, slot, effect_id);
}

function has_curse(state: GameState, slot: PlayerSlot, curse_id: CurseCollateralId): boolean {
  return !!curse_state(state, slot, curse_id);
}

function curse_stacks(state: GameState, slot: PlayerSlot, curse_id: CurseCollateralId): number {
  return curse_state(state, slot, curse_id)?.stacks ?? 0;
}

function curse_turns_remaining(state: GameState, slot: PlayerSlot, curse_id: CurseCollateralId): number {
  const remaining = curse_state(state, slot, curse_id)?.remainingTurns;
  if (typeof remaining !== "number" || !Number.isFinite(remaining)) {
    return 0;
  }
  return Math.max(0, normalize_int(remaining, 0, 0));
}

function effect_turns_remaining(state: GameState, slot: PlayerSlot, effect_id: EffectCollateralId): number {
  return effect_state(state, slot, effect_id)?.remainingTurns ?? 0;
}

function is_negative_stat_effect_id(effect_id: string): boolean {
  return NEGATIVE_STAT_EFFECT_ID_SET.has(effect_id as EffectCollateralId);
}

function is_negative_stat_buff_debuff(entry: ActiveBuffDebuffState): boolean {
  return (
    (entry.stat === "attack" || entry.stat === "defense" || entry.stat === "speed") &&
    normalize_int(entry.deltaPercent, 0, -99999) < 0
  );
}

function upsert_effect(
  state: GameState,
  log: EventLog[],
  target_slot: PlayerSlot,
  effect_id: EffectCollateralId,
  duration_turns: number,
  source_slot: PlayerSlot,
  source_move_id: string
): void {
  ensure_state_runtime_defaults(state);
  const duration = Math.max(1, normalize_int(duration_turns, 1, 1));
  const effects = state.activeEffectsBySlot[target_slot];
  const existing = effects.find((entry) => entry.id === effect_id) ?? null;
  const before_remaining = existing?.remainingTurns ?? 0;
  if (existing) {
    existing.remainingTurns = Math.max(existing.remainingTurns, duration);
    existing.appliedTurn = state.turn;
  } else {
    effects.push({ id: effect_id, remainingTurns: duration, appliedTurn: state.turn });
  }
  const after_remaining = existing?.remainingTurns ?? duration;
  log.push({
    type: "effect_apply",
    turn: state.turn,
    summary: `${effect_label(effect_id)} applied on ${target_slot} (${after_remaining} turn${after_remaining === 1 ? "" : "s"})`,
    data: {
      slot: source_slot,
      targetSlot: target_slot,
      move: source_move_id,
      effect: effect_id,
      beforeTurns: before_remaining,
      afterTurns: after_remaining
    }
  });
}

function apply_move_effects_from_collateral(
  state: GameState,
  log: EventLog[],
  source_slot: PlayerSlot,
  collaterals: readonly EffectCollateral[],
  source_move_id: string,
  source_phase_id: string
): void {
  if (collaterals.length === 0) {
    return;
  }
  for (const collateral of collaterals) {
    const target_slot: PlayerSlot = collateral.target === "self" ? source_slot : other_slot(source_slot);
    if (is_special_protect_blocking_target_effect(state, source_slot, target_slot, source_phase_id)) {
      log_special_protect_block(state, log, source_slot, target_slot, source_move_id, source_phase_id, "effects");
      continue;
    }
    upsert_effect(
      state,
      log,
      target_slot,
      collateral.id,
      collateral.maxDurationTurns,
      source_slot,
      source_move_id
    );
  }
}

type UpsertCurseOptions = {
  remainingTurns?: number;
};

function upsert_curse(
  state: GameState,
  log: EventLog[],
  target_slot: PlayerSlot,
  curse_id: CurseCollateralId,
  source_slot: PlayerSlot | null,
  source_move_id: string,
  options?: UpsertCurseOptions
): void {
  ensure_state_runtime_defaults(state);
  const curses = state.activeCursesBySlot[target_slot];
  const requested_remaining_turns =
    typeof options?.remainingTurns === "number" && Number.isFinite(options.remainingTurns)
      ? Math.max(1, normalize_int(options.remainingTurns, 1, 1))
      : undefined;
  const existing = curses.find((entry) => entry.id === curse_id) ?? null;
  if (existing) {
    if (curse_id === "sekyps") {
      const before_stack = Math.max(1, normalize_int(existing.stacks, 1, 1));
      const after_stack = before_stack + 1;
      existing.stacks = after_stack;
      // A newly added Sekyps stack only starts ticking on the next turn.
      existing.appliedTurn = state.turn;
      log.push({
        type: "curse_apply",
        turn: state.turn,
        summary: `Sekyps stacked on ${target_slot} (${before_stack} -> ${after_stack})`,
        data: {
          slot: source_slot,
          targetSlot: target_slot,
          move: source_move_id,
          curse: curse_id,
          alreadyActive: true,
          stackBefore: before_stack,
          stackAfter: after_stack
        }
      });
      return;
    }
    log.push({
      type: "curse_apply",
      turn: state.turn,
      summary: `${curse_label(curse_id)} already active on ${target_slot} (no stack)`,
      data: {
        slot: source_slot,
        targetSlot: target_slot,
        move: source_move_id,
        curse: curse_id,
        alreadyActive: true,
        remainingTurns:
          typeof existing.remainingTurns === "number" && Number.isFinite(existing.remainingTurns)
            ? Math.max(1, normalize_int(existing.remainingTurns, 1, 1))
            : null
      }
    });
    return;
  }
  curses.push({
    id: curse_id,
    sourceSlot: source_slot,
    stacks: 1,
    appliedTurn: state.turn,
    ...(typeof requested_remaining_turns === "number" ? { remainingTurns: requested_remaining_turns } : {})
  });
  log.push({
    type: "curse_apply",
    turn: state.turn,
    summary:
      typeof requested_remaining_turns === "number"
        ? `${curse_label(curse_id)} cursed ${target_slot} (${requested_remaining_turns} turn${requested_remaining_turns === 1 ? "" : "s"})`
        : `${curse_label(curse_id)} cursed ${target_slot}`,
    data: {
      slot: source_slot,
      targetSlot: target_slot,
      move: source_move_id,
      curse: curse_id,
      alreadyActive: false,
      remainingTurns: typeof requested_remaining_turns === "number" ? requested_remaining_turns : null
    }
  });
}

type HealBuffUpsertOptions = {
  id: string;
  source: string;
  healPerTurn: number;
  growthPerTurn?: number;
  startTurn?: number;
  remainingTicks?: number | null;
  clearsOnSwitch?: boolean;
};

function upsert_heal_buff(
  state: GameState,
  log: EventLog[],
  target_slot: PlayerSlot,
  source_slot: PlayerSlot | null,
  source_move_id: string,
  options: HealBuffUpsertOptions
): ActiveHealBuffState {
  ensure_state_runtime_defaults(state);
  const heal_per_turn = Math.max(0, normalize_int(options.healPerTurn, 0, 0));
  const growth_per_turn = normalize_int(options.growthPerTurn ?? 0, 0, -1000000);
  const start_turn = Math.max(0, normalize_int(options.startTurn ?? state.turn, state.turn, 0));
  const remaining_ticks =
    typeof options.remainingTicks === "number" && Number.isFinite(options.remainingTicks)
      ? Math.max(1, normalize_int(options.remainingTicks, 1, 1))
      : null;
  const clears_on_switch = options.clearsOnSwitch === true;

  const buffs = state.activeHealBuffsBySlot[target_slot];
  const existing = buffs.find((entry) => entry.id === options.id) ?? null;
  if (existing) {
    const before_heal_per_turn = existing.healPerTurn;
    const before_growth_per_turn = existing.growthPerTurn;
    existing.healPerTurn = Math.max(0, existing.healPerTurn + heal_per_turn);
    existing.growthPerTurn = normalize_int(existing.growthPerTurn + growth_per_turn, existing.growthPerTurn, -1000000);
    existing.startTurn = Math.min(existing.startTurn, start_turn);
    if (existing.remainingTicks === null || remaining_ticks === null) {
      existing.remainingTicks = null;
    } else {
      existing.remainingTicks = Math.max(existing.remainingTicks, remaining_ticks);
    }
    existing.clearsOnSwitch = existing.clearsOnSwitch || clears_on_switch;
    existing.source = options.source;
    existing.sourceSlot = source_slot;
    log.push({
      type: "heal_buff_apply",
      turn: state.turn,
      summary: `Heal buff ${options.id} updated on ${target_slot} (${before_heal_per_turn} -> ${existing.healPerTurn}/turn)`,
      data: {
        slot: source_slot,
        targetSlot: target_slot,
        move: source_move_id,
        buff: options.id,
        source: options.source,
        healPerTurnBefore: before_heal_per_turn,
        healPerTurnAfter: existing.healPerTurn,
        growthPerTurnBefore: before_growth_per_turn,
        growthPerTurnAfter: existing.growthPerTurn,
        startTurn: existing.startTurn,
        remainingTicks: existing.remainingTicks,
        clearsOnSwitch: existing.clearsOnSwitch
      }
    });
    return existing;
  }

  const created: ActiveHealBuffState = {
    id: options.id,
    sourceSlot: source_slot,
    source: options.source,
    healPerTurn: heal_per_turn,
    growthPerTurn: growth_per_turn,
    startTurn: start_turn,
    remainingTicks: remaining_ticks,
    clearsOnSwitch: clears_on_switch
  };
  buffs.push(created);
  log.push({
    type: "heal_buff_apply",
    turn: state.turn,
    summary: `Heal buff ${options.id} applied on ${target_slot} (+${heal_per_turn}/turn)`,
    data: {
      slot: source_slot,
      targetSlot: target_slot,
      move: source_move_id,
      buff: options.id,
      source: options.source,
      healPerTurn: created.healPerTurn,
      growthPerTurn: created.growthPerTurn,
      startTurn: created.startTurn,
      remainingTicks: created.remainingTicks,
      clearsOnSwitch: created.clearsOnSwitch
    }
  });
  return created;
}

function apply_heal_amount(
  state: GameState,
  slot: PlayerSlot,
  hp_changed: WeakSet<MonsterState>,
  heal_amount: number
): { before: number; after: number; healed: number } {
  const player = state.players[slot];
  const target = active_monster(player);
  const before_hp = player.sharedHp;
  const heal_attempt = Math.max(0, normalize_int(heal_amount, 0, 0));
  const after_hp = Math.min(player.sharedHpMax, before_hp + heal_attempt);
  const healed = Math.max(0, after_hp - before_hp);
  if (healed > 0) {
    sync_player_shared_hp(state, slot, after_hp);
    hp_changed.add(target);
  }
  return { before: before_hp, after: after_hp, healed };
}

function apply_heal_buff_tick(
  state: GameState,
  log: EventLog[],
  slot: PlayerSlot,
  hp_changed: WeakSet<MonsterState>,
  buff: ActiveHealBuffState,
  phase: string = END_PHASE_ID
): boolean {
  const player = state.players[slot];
  const target = active_monster(player);
  const heal_per_turn = Math.max(0, normalize_int(buff.healPerTurn, 0, 0));
  let next_heal_per_turn = Math.max(0, normalize_int(buff.healPerTurn + buff.growthPerTurn, buff.healPerTurn, 0));
  let heal_attempt = heal_per_turn;
  if (buff.id === REJUVENATION_REGEN_HEAL_BUFF_ID) {
    const base_regen = REJUVENATION_REGEN_FLAT_PER_STACK;
    const max_regen_per_turn = base_regen * REJUVENATION_REGEN_STACK_MAX;
    heal_attempt = Math.min(max_regen_per_turn, heal_per_turn);
    next_heal_per_turn = Math.min(max_regen_per_turn, next_heal_per_turn);
  }
  const result = apply_heal_amount(state, slot, hp_changed, heal_attempt);

  if (buff.id === TYPE_BUF_REGEN_HEAL_BUFF_ID) {
    const regen_stack = Math.max(0, Math.floor(heal_per_turn / TYPE_PASSIVE_BUF_REGEN_PER_STACK));
    state.typePassiveRegenStacks[slot] = regen_stack;
    log.push({
      type: "type_passive_regen",
      turn: state.turn,
      phase,
      summary: `${target.name} healed ${result.healed} from BUF passive (${regen_stack} stack)`,
      data: {
        slot,
        target: target.id,
        regenStack: regen_stack,
        healPerStack: TYPE_PASSIVE_BUF_REGEN_PER_STACK,
        healAttempted: heal_per_turn,
        healApplied: result.healed,
        before: result.before,
        after: result.after
      }
    });
  } else if (buff.id === REJUVENATION_REGEN_HEAL_BUFF_ID) {
    const base_regen = REJUVENATION_REGEN_FLAT_PER_STACK;
    const stack = Math.min(REJUVENATION_REGEN_STACK_MAX, Math.max(1, Math.floor(Math.max(1, heal_attempt) / base_regen)));
    const next_stack = Math.min(
      REJUVENATION_REGEN_STACK_MAX,
      Math.max(1, Math.floor(Math.max(1, next_heal_per_turn) / base_regen))
    );
    state.rejuvenationStacks[slot] = next_stack;
    state.rejuvenationStartTurn[slot] = buff.startTurn;
    log.push({
      type: "rejuvenation_regen",
      turn: state.turn,
      phase,
      summary: `${target.name} healed ${result.healed} from Rejuvenation regen (stack ${stack}: +${heal_attempt}/turn)`,
      data: {
        slot,
        target: target.id,
        stack,
        nextStack: next_stack,
        healPerTurn: heal_attempt,
        nextHealPerTurn: next_heal_per_turn,
        healAttempted: heal_attempt,
        healApplied: result.healed,
        before: result.before,
        after: result.after
      }
    });
  } else if (buff.id === HEAL_MOVE_HEAL_BUFF_ID) {
    log.push({
      type: "passive_heal",
      turn: state.turn,
      phase,
      summary: `${target.name} healed ${result.healed} with Heal`,
      data: {
        slot,
        source: target.id,
        target: target.id,
        amount: result.healed,
        before: result.before,
        after: result.after
      }
    });
  } else if (buff.id === RECOVER_MOVE_HEAL_BUFF_ID) {
    log.push({
      type: "passive_heal",
      turn: state.turn,
      phase,
      summary: `${target.name} healed ${result.healed} with Recover`,
      data: {
        slot,
        source: target.id,
        target: target.id,
        amount: result.healed,
        before: result.before,
        after: result.after
      }
    });
  } else {
    log.push({
      type: "heal_buff_tick",
      turn: state.turn,
      phase,
      summary: `${target.name} healed ${result.healed} from ${buff.source}`,
      data: {
        slot,
        sourceSlot: buff.sourceSlot,
        source: buff.source,
        buff: buff.id,
        healAttempted: heal_attempt,
        healApplied: result.healed,
        before: result.before,
        after: result.after
      }
    });
  }

  buff.healPerTurn = next_heal_per_turn;
  if (buff.id === REJUVENATION_REGEN_HEAL_BUFF_ID) {
    // Rejuvenation only increases regen on recast. Consume any pending growth after this tick.
    buff.growthPerTurn = 0;
  }
  if (buff.remainingTicks !== null) {
    buff.remainingTicks = Math.max(0, buff.remainingTicks - 1);
  }
  return buff.remainingTicks === null || buff.remainingTicks > 0;
}

function apply_heal_buffs_end_turn_by_id(
  state: GameState,
  log: EventLog[],
  slot: PlayerSlot,
  hp_changed: WeakSet<MonsterState>,
  heal_buff_id: string
): void {
  ensure_state_runtime_defaults(state);
  const buffs = state.activeHealBuffsBySlot[slot];
  if (!Array.isArray(buffs) || buffs.length === 0) {
    return;
  }

  const next: ActiveHealBuffState[] = [];
  for (const buff of buffs) {
    if (buff.id !== heal_buff_id) {
      next.push(buff);
      continue;
    }
    if (state.turn < buff.startTurn) {
      next.push(buff);
      continue;
    }
    const keep = apply_heal_buff_tick(state, log, slot, hp_changed, buff, END_PHASE_ID);
    if (keep) {
      next.push(buff);
      continue;
    }
    log.push({
      type: "heal_buff_end",
      turn: state.turn,
      phase: END_PHASE_ID,
      summary: `Heal buff ${buff.id} ended on ${slot}`,
      data: { targetSlot: slot, buff: buff.id, source: buff.source, sourceSlot: buff.sourceSlot }
    });
  }
  state.activeHealBuffsBySlot[slot] = next;
  if (heal_buff_id === TYPE_BUF_REGEN_HEAL_BUFF_ID && !next.some((entry) => entry.id === TYPE_BUF_REGEN_HEAL_BUFF_ID)) {
    state.typePassiveRegenStacks[slot] = 0;
  }
  if (heal_buff_id === REJUVENATION_REGEN_HEAL_BUFF_ID && !next.some((entry) => entry.id === REJUVENATION_REGEN_HEAL_BUFF_ID)) {
    state.rejuvenationStacks[slot] = 0;
    state.rejuvenationStartTurn[slot] = 0;
  }
}

function apply_move_curses_from_collateral(
  state: GameState,
  log: EventLog[],
  source_slot: PlayerSlot,
  collaterals: readonly CurseCollateral[],
  source_move_id: string,
  source_phase_id: string
): void {
  if (collaterals.length === 0) {
    return;
  }
  for (const collateral of collaterals) {
    const target_slot: PlayerSlot = source_slot === "player1" ? "player2" : "player1";
    if (is_special_protect_blocking_target_effect(state, source_slot, target_slot, source_phase_id)) {
      log_special_protect_block(state, log, source_slot, target_slot, source_move_id, source_phase_id, "curse");
      continue;
    }
    upsert_curse(state, log, target_slot, collateral.id, source_slot, source_move_id);
  }
}

function stat_label_for_buff(stat: BuffDebuffStat): string {
  if (stat === "attack") return "ATK";
  if (stat === "defense") return "DEF";
  return "DEX";
}

function stat_value_for_active_monster(monster: MonsterState, stat: BuffDebuffStat): number {
  if (stat === "attack") return monster.attack;
  if (stat === "defense") return monster.defense;
  return monster.speed;
}

function apply_buff_debuff_component(
  state: GameState,
  log: EventLog[],
  target_slot: PlayerSlot,
  collateral: BuffDebuffCollateral,
  source_slot: PlayerSlot | null,
  source_move_id: string,
  options?: { targetMonsterId?: string }
): void {
  ensure_state_runtime_defaults(state);
  const target = active_monster(state.players[target_slot]);
  refresh_active_monster_stats_for_slot(state, target_slot);
  const before = stat_value_for_active_monster(target, collateral.stat);
  const clears_on_switch = collateral.clearsOnSwitch === true;
  const target_monster_id = typeof options?.targetMonsterId === "string" ? options.targetMonsterId : undefined;
  state.activeBuffDebuffsBySlot[target_slot].push({
    id: collateral.id,
    sourceSlot: source_slot,
    source: source_move_id,
    stat: collateral.stat,
    deltaPercent: collateral.deltaPercent,
    clearsOnSwitch: clears_on_switch,
    ...(target_monster_id ? { targetMonsterId: target_monster_id } : {})
  });
  refresh_active_monster_stats_for_slot(state, target_slot);
  const after = stat_value_for_active_monster(target, collateral.stat);
  const total_delta = total_delta_percent_from_buff_debuffs(state, target_slot, collateral.stat);
  const total_percent = stat_multiplier_percent_from_delta(total_delta);
  log.push({
    type: "buff_debuff_apply",
    turn: state.turn,
    summary: `${target.name} ${stat_label_for_buff(collateral.stat)} ${(collateral.deltaPercent >= 0 ? "+" : "") + collateral.deltaPercent}%`,
    data: {
      slot: source_slot,
      targetSlot: target_slot,
      move: source_move_id,
      componentId: collateral.id,
      stat: collateral.stat,
      deltaPercent: collateral.deltaPercent,
      totalDeltaPercent: total_delta,
      totalPercent: total_percent,
      before,
      after
    }
  });
}

function apply_move_buff_debuffs_from_collateral(
  state: GameState,
  log: EventLog[],
  source_slot: PlayerSlot,
  collaterals: readonly BuffDebuffCollateral[],
  source_move_id: string,
  source_phase_id: string
): void {
  if (collaterals.length === 0) {
    return;
  }
  for (const collateral of collaterals) {
    const target_slot: PlayerSlot = collateral.target === "self" ? source_slot : other_slot(source_slot);
    if (is_special_protect_blocking_target_effect(state, source_slot, target_slot, source_phase_id)) {
      log_special_protect_block(state, log, source_slot, target_slot, source_move_id, source_phase_id, "buff/debuff");
      continue;
    }
    apply_buff_debuff_component(state, log, target_slot, collateral, source_slot, source_move_id);
  }
}

function apply_move_instants_from_collateral(
  state: GameState,
  log: EventLog[],
  source_slot: PlayerSlot,
  collaterals: readonly InstantCollateral[],
  source_move_id: string,
  source_phase_id: string
): void {
  if (collaterals.length === 0) {
    return;
  }
  for (const collateral of collaterals) {
    const target_slot: PlayerSlot = collateral.target === "self" ? source_slot : other_slot(source_slot);
    if (is_special_protect_blocking_target_effect(state, source_slot, target_slot, source_phase_id)) {
      log_special_protect_block(state, log, source_slot, target_slot, source_move_id, source_phase_id, "instant");
      continue;
    }
    log.push({
      type: "instant_trigger",
      turn: state.turn,
      summary: `Instant ${collateral.id} triggered by ${source_move_id}`,
      data: {
        slot: source_slot,
        targetSlot: target_slot,
        move: source_move_id,
        instant: collateral.id
      }
    });
  }
}

function decay_effects_end_turn(state: GameState, log: EventLog[]): void {
  ensure_state_runtime_defaults(state);
  for (const slot of SLOT_ORDER) {
    const current = state.activeEffectsBySlot[slot];
    if (!Array.isArray(current) || current.length === 0) {
      state.activeEffectsBySlot[slot] = [];
      continue;
    }
    const next: ActiveEffectState[] = [];
    for (const effect of current) {
      if ((effect.appliedTurn ?? -1) === state.turn) {
        next.push({ id: effect.id, remainingTurns: Math.max(1, normalize_int(effect.remainingTurns, 1, 1)) });
        continue;
      }
      const remaining = Math.max(0, normalize_int(effect.remainingTurns, 1, 0) - 1);
      if (remaining > 0) {
        next.push({ id: effect.id, remainingTurns: remaining });
        continue;
      }
      log.push({
        type: "effect_end",
        turn: state.turn,
        summary: `${effect_label(effect.id)} ended on ${slot}`,
        data: { targetSlot: slot, effect: effect.id }
      });
    }
    state.activeEffectsBySlot[slot] = next;
  }
}

function decay_curses_end_turn(state: GameState, log: EventLog[]): void {
  ensure_state_runtime_defaults(state);
  for (const slot of SLOT_ORDER) {
    const current = state.activeCursesBySlot[slot];
    if (!Array.isArray(current) || current.length === 0) {
      state.activeCursesBySlot[slot] = [];
      continue;
    }
    const next: ActiveCurseState[] = [];
    for (const curse of current) {
      if (typeof curse.remainingTurns !== "number" || !Number.isFinite(curse.remainingTurns)) {
        next.push(curse);
        continue;
      }
      if ((curse.appliedTurn ?? -1) === state.turn) {
        next.push({
          ...curse,
          remainingTurns: Math.max(1, normalize_int(curse.remainingTurns, 1, 1))
        });
        continue;
      }
      const remaining = Math.max(0, normalize_int(curse.remainingTurns, 1, 0) - 1);
      if (remaining > 0) {
        next.push({ ...curse, remainingTurns: remaining });
        continue;
      }
      log.push({
        type: "curse_end",
        turn: state.turn,
        summary: `${curse_label(curse.id)} ended on ${slot}`,
        data: { slot, source: curse.sourceSlot, curse: curse.id, reason: "duration" }
      });
    }
    state.activeCursesBySlot[slot] = next;
  }
}

function is_slot_taunted(state: GameState, slot: PlayerSlot): boolean {
  return (state.tauntUntilTurn?.[slot] ?? 0) >= state.turn || has_effect(state, slot, "taunt");
}

function normalize_type_passive_stack(value: unknown, fallback: number, min: number, max: number): number {
  const raw = typeof value === "number" ? value : fallback;
  return Math.max(min, Math.min(max, normalize_int(raw, fallback, min)));
}

function is_slot_arena_trapped(state: GameState, slot: PlayerSlot): boolean {
  const trapped_until = state.arenaTrapUntilTurn?.[slot] ?? 0;
  return trapped_until > 0 && trapped_until >= state.turn;
}

function type_passive_armor_stack(state: GameState, slot: PlayerSlot): number {
  return normalize_type_passive_stack(
    state.typePassiveArmorStacks?.[slot],
    0,
    0,
    TYPE_PASSIVE_DEF_ARMOR_STACK_MAX
  );
}

function type_passive_regen_stack(state: GameState, slot: PlayerSlot): number {
  return normalize_type_passive_stack(state.typePassiveRegenStacks?.[slot], 0, 0, 9999);
}

function rejuvenation_stack(state: GameState, slot: PlayerSlot): number {
  return normalize_type_passive_stack(state.rejuvenationStacks?.[slot], 0, 0, REJUVENATION_REGEN_STACK_MAX);
}

function rejuvenation_start_turn(state: GameState, slot: PlayerSlot): number {
  return normalize_int(state.rejuvenationStartTurn?.[slot], 0, 0);
}

function is_slot_clear_body_active(state: GameState, slot: PlayerSlot): boolean {
  return type_passive_armor_stack(state, slot) > 0;
}

function is_attack_move(spec: { id: string; phaseId: string }): boolean {
  if (spec.phaseId !== "attack_01") {
    return false;
  }
  return !TAUNT_BLOCKED_MOVE_IDS.has(spec.id);
}

function is_skill_move(spec: { id: string; phaseId: string }): boolean {
  return !is_attack_move(spec);
}

function has_available_switch_target(player: PlayerState): boolean {
  return first_available_switch_target(player) !== null;
}

function first_available_switch_target(player: PlayerState): number | null {
  for (let index = 0; index < player.team.length; index++) {
    if (index === player.activeIndex) {
      continue;
    }
    if (is_alive(player.team[index])) {
      return index;
    }
  }
  return null;
}

function switch_block_reason(state: GameState, slot: PlayerSlot): string | null {
  if (is_slot_arena_trapped(state, slot)) {
    return "arena trapped";
  }
  if (is_slot_taunted(state, slot)) {
    return "taunt";
  }
  if (has_effect(state, slot, "confuse")) {
    return "confuse";
  }
  if (has_effect(state, slot, "immobilize")) {
    return "immobilize";
  }
  return null;
}

function move_block_reason(
  state: GameState,
  slot: PlayerSlot,
  move_index: number,
  spec: ReturnType<typeof move_spec>
): string | null {
  const player = state.players[slot];
  const attack_move = is_attack_move(spec);
  const skill_move = is_skill_move(spec);
  const has_switch_target = has_available_switch_target(player);

  if (has_switch_target && has_effect(state, slot, "nocaute")) {
    return "nocaute";
  }
  if (has_effect(state, slot, "sleep")) {
    return "sleep";
  }
  if (attack_move && has_effect(state, slot, "stun")) {
    return "stun";
  }
  if (attack_move && has_effect(state, slot, "confuse")) {
    return "confuse";
  }
  if (skill_move && has_effect(state, slot, "silence")) {
    return "silence";
  }
  if (skill_move && is_slot_taunted(state, slot)) {
    return "taunt";
  }
  const last_move = state.lastMoveIndexBySlot?.[slot] ?? null;
  if (typeof last_move === "number" && has_curse(state, slot, "frustration") && move_index === last_move) {
    return "frustration";
  }
  if (typeof last_move === "number" && has_curse(state, slot, "happiness") && move_index !== last_move) {
    return "happiness";
  }
  return null;
}

function run_block_reason(state: GameState, slot: PlayerSlot): string | null {
  const player = state.players[slot];
  if (has_available_switch_target(player) && has_effect(state, slot, "nocaute")) {
    return "nocaute";
  }
  if (has_effect(state, slot, "sleep")) {
    return "sleep";
  }
  if (has_effect(state, slot, "silence")) {
    return "silence";
  }
  if (is_slot_taunted(state, slot)) {
    return "taunt";
  }
  return null;
}

function move_block_summary(slot: PlayerSlot, reason: string, spec_label: string): string {
  if (reason === "nocaute") {
    return `${slot} cannot use ${spec_label} (Nocaute forces switch)`;
  }
  if (reason === "sleep") {
    return `${slot} cannot use ${spec_label} (Sleep)`;
  }
  if (reason === "stun") {
    return `${slot} cannot use ${spec_label} (Stun blocks moves)`;
  }
  if (reason === "silence") {
    return `${slot} cannot use ${spec_label} (Silence blocks skills)`;
  }
  if (reason === "taunt") {
    return `${slot} cannot use ${spec_label} (Taunt forces attack moves)`;
  }
  if (reason === "happiness") {
    return `${slot} cannot use ${spec_label} (Happiness allows only last move)`;
  }
  if (reason === "frustration") {
    return `${slot} cannot use ${spec_label} (Frustration blocks last move)`;
  }
  return `${slot} cannot use ${spec_label} (${effect_label(reason)})`;
}

function mark_last_move_used(state: GameState, slot: PlayerSlot, move_id: MoveId, move_index: number): void {
  ensure_state_runtime_defaults(state);
  if (move_id === "none") {
    return;
  }
  state.lastMoveIndexBySlot[slot] = move_index;
}

function reset_fervor_chain(state: GameState, slot: PlayerSlot): void {
  ensure_state_runtime_defaults(state);
  state.fervorChainBySlot[slot] = 0;
}

function update_fervor_chain_after_move_success(state: GameState, slot: PlayerSlot, move_id: MoveId): void {
  ensure_state_runtime_defaults(state);
  if (move_id !== "fervor") {
    state.fervorChainBySlot[slot] = 0;
    return;
  }
  const current = normalize_fervor_chain(state.fervorChainBySlot[slot]);
  state.fervorChainBySlot[slot] = Math.min(FERVOR_CHAIN_MAX, current + 1);
}

function clone_player(player: PlayerState): PlayerState {
  const active = player.team[player.activeIndex] ?? player.team[0];
  const fallback_max_hp = active ? normalize_int(active.maxHp, SHARED_HP_START, 1) : SHARED_HP_START;
  const shared_hp_max = Math.max(1, normalize_int(player.sharedHpMax, fallback_max_hp, 1));
  const fallback_shared_hp = active ? normalize_int(active.hp, shared_hp_max, 0) : shared_hp_max;
  const shared_hp = Math.max(0, Math.min(shared_hp_max, normalize_int(player.sharedHp, fallback_shared_hp, 0)));
  const fallback_shared_mSPE = active ? normalize_int(active.mSPE, SHARED_MSPE_START, 0) : SHARED_MSPE_START;
  const shared_mSPE = Math.max(0, normalize_int(player.sharedMSPE, fallback_shared_mSPE, 0));
  return {
    slot: player.slot,
    name: player.name,
    sharedHp: shared_hp,
    sharedHpMax: shared_hp_max,
    sharedMSPE: shared_mSPE,
    team: player.team.map(clone_monster),
    activeIndex: player.activeIndex
  };
}

export function clone_state(state: GameState): GameState {
  const cloned: GameState = {
    turn: state.turn,
    status: state.status,
    winner: state.winner,
    endReason: state.endReason,
    mSPESlots: Array.isArray(state.mSPESlots) ? state.mSPESlots.slice() : undefined,
    baseTurnLimit: Math.max(1, normalize_int(state.baseTurnLimit, BASE_TURN_LIMIT, 1)),
    rpsScore: empty_rps_score(),
    mSPETelemetry: empty_mSPE_telemetry(),
    typePassiveArmorStacks: empty_type_passive_armor_stacks(),
    typePassiveRegenStacks: empty_type_passive_regen_stacks(),
    rejuvenationStacks: empty_rejuvenation_stacks(),
    rejuvenationStartTurn: empty_rejuvenation_start_turn(),
    fervorChainBySlot: empty_fervor_chain_by_slot(),
    arenaTrapUntilTurn: empty_arena_trap_until_turn(),
    spikesArmedByTarget: empty_spikes_armed_by_target(),
    players: {
      player1: clone_player(state.players.player1),
      player2: clone_player(state.players.player2)
    },
    pendingSwitch: empty_pending(),
    pendingSwitchReason: empty_pending_switch_reason(),
    pendingSwitchResolvedThisTurn: empty_pending_switch_resolved_this_turn(),
    pendingWish: empty_pending_wish(),
    tauntUntilTurn: empty_taunt_until_turn(),
    activeEffectsBySlot: empty_active_effects(),
    activeCursesBySlot: empty_active_curses(),
    activeBuffDebuffsBySlot: empty_active_buff_debuffs(),
    activeHealBuffsBySlot: empty_active_heal_buffs(),
    lastMoveIndexBySlot: empty_last_move_index(),
  };
  cloned.rpsScore.player1 = normalize_int(state.rpsScore?.player1, 0, -99999);
  cloned.rpsScore.player2 = normalize_int(state.rpsScore?.player2, 0, -99999);
  cloned.typePassiveArmorStacks.player1 = normalize_type_passive_stack(
    state.typePassiveArmorStacks?.player1,
    0,
    0,
    TYPE_PASSIVE_DEF_ARMOR_STACK_MAX
  );
  cloned.typePassiveArmorStacks.player2 = normalize_type_passive_stack(
    state.typePassiveArmorStacks?.player2,
    0,
    0,
    TYPE_PASSIVE_DEF_ARMOR_STACK_MAX
  );
  cloned.typePassiveRegenStacks.player1 = normalize_type_passive_stack(state.typePassiveRegenStacks?.player1, 0, 0, 9999);
  cloned.typePassiveRegenStacks.player2 = normalize_type_passive_stack(state.typePassiveRegenStacks?.player2, 0, 0, 9999);
  cloned.rejuvenationStacks.player1 = normalize_type_passive_stack(
    state.rejuvenationStacks?.player1,
    0,
    0,
    REJUVENATION_REGEN_STACK_MAX
  );
  cloned.rejuvenationStacks.player2 = normalize_type_passive_stack(
    state.rejuvenationStacks?.player2,
    0,
    0,
    REJUVENATION_REGEN_STACK_MAX
  );
  cloned.rejuvenationStartTurn.player1 = normalize_int(state.rejuvenationStartTurn?.player1, 0, 0);
  cloned.rejuvenationStartTurn.player2 = normalize_int(state.rejuvenationStartTurn?.player2, 0, 0);
  cloned.fervorChainBySlot.player1 = normalize_fervor_chain(state.fervorChainBySlot?.player1);
  cloned.fervorChainBySlot.player2 = normalize_fervor_chain(state.fervorChainBySlot?.player2);
  cloned.arenaTrapUntilTurn.player1 = normalize_int(state.arenaTrapUntilTurn?.player1, 0, 0);
  cloned.arenaTrapUntilTurn.player2 = normalize_int(state.arenaTrapUntilTurn?.player2, 0, 0);
  cloned.spikesArmedByTarget.player1 = !!state.spikesArmedByTarget?.player1;
  cloned.spikesArmedByTarget.player2 = !!state.spikesArmedByTarget?.player2;
  cloned.pendingSwitch.player1 = !!state.pendingSwitch?.player1;
  cloned.pendingSwitch.player2 = !!state.pendingSwitch?.player2;
  cloned.pendingSwitchReason.player1 = state.pendingSwitchReason?.player1 ?? "none";
  cloned.pendingSwitchReason.player2 = state.pendingSwitchReason?.player2 ?? "none";
  cloned.pendingSwitchResolvedThisTurn.player1 = !!state.pendingSwitchResolvedThisTurn?.player1;
  cloned.pendingSwitchResolvedThisTurn.player2 = !!state.pendingSwitchResolvedThisTurn?.player2;
  cloned.pendingWish.player1 = state.pendingWish?.player1 ?? null;
  cloned.pendingWish.player2 = state.pendingWish?.player2 ?? null;
  cloned.tauntUntilTurn.player1 = state.tauntUntilTurn?.player1 ?? 0;
  cloned.tauntUntilTurn.player2 = state.tauntUntilTurn?.player2 ?? 0;
  cloned.activeEffectsBySlot.player1 = normalize_active_effects(state.activeEffectsBySlot?.player1);
  cloned.activeEffectsBySlot.player2 = normalize_active_effects(state.activeEffectsBySlot?.player2);
  cloned.activeCursesBySlot.player1 = normalize_active_curses(state.activeCursesBySlot?.player1);
  cloned.activeCursesBySlot.player2 = normalize_active_curses(state.activeCursesBySlot?.player2);
  cloned.activeBuffDebuffsBySlot.player1 = normalize_active_buff_debuffs(state.activeBuffDebuffsBySlot?.player1);
  cloned.activeBuffDebuffsBySlot.player2 = normalize_active_buff_debuffs(state.activeBuffDebuffsBySlot?.player2);
  cloned.activeHealBuffsBySlot.player1 = normalize_active_heal_buffs(state.activeHealBuffsBySlot?.player1);
  cloned.activeHealBuffsBySlot.player2 = normalize_active_heal_buffs(state.activeHealBuffsBySlot?.player2);
  const last_move_p1 = state.lastMoveIndexBySlot?.player1;
  const last_move_p2 = state.lastMoveIndexBySlot?.player2;
  cloned.lastMoveIndexBySlot.player1 =
    typeof last_move_p1 === "number" && Number.isInteger(last_move_p1) ? Math.max(0, last_move_p1) : null;
  cloned.lastMoveIndexBySlot.player2 =
    typeof last_move_p2 === "number" && Number.isInteger(last_move_p2) ? Math.max(0, last_move_p2) : null;
  sync_all_players_shared_hp(cloned);
  sync_all_players_shared_mSPE(cloned);
  refresh_active_monster_stats(cloned);
  refresh_mSPE_telemetry(cloned);
  return cloned;
}

function active_monster(player: PlayerState): MonsterState {
  return player.team[player.activeIndex];
}

function other_slot(slot: PlayerSlot): PlayerSlot {
  return slot === "player1" ? "player2" : "player1";
}

function sync_player_shared_hp(state: GameState, slot: PlayerSlot, next_hp: number): number {
  const player = state.players[slot];
  const max_hp = Math.max(1, normalize_int(player.sharedHpMax, SHARED_HP_START, 1));
  const clamped = Math.max(0, Math.min(max_hp, normalize_int(next_hp, max_hp, 0)));
  player.sharedHpMax = max_hp;
  player.sharedHp = clamped;
  for (const monster of player.team) {
    monster.maxHp = max_hp;
    monster.hp = clamped;
  }
  return clamped;
}

function sync_player_shared_mSPE(state: GameState, slot: PlayerSlot, next_mSPE: number): number {
  const player = state.players[slot];
  const clamped = Math.max(0, normalize_int(next_mSPE, SHARED_MSPE_START, 0));
  player.sharedMSPE = clamped;
  for (const monster of player.team) {
    monster.mSPE = clamped;
  }
  return clamped;
}

function sync_all_players_shared_hp(state: GameState): void {
  for (const slot of SLOT_ORDER) {
    const player = state.players[slot];
    const active = player.team[player.activeIndex] ?? player.team[0];
    const fallback_max_hp = active ? normalize_int(active.maxHp, SHARED_HP_START, 1) : SHARED_HP_START;
    const shared_hp_max = Math.max(1, normalize_int(player.sharedHpMax, fallback_max_hp, 1));
    player.sharedHpMax = shared_hp_max;
    const fallback_shared_hp = active ? normalize_int(active.hp, shared_hp_max, 0) : shared_hp_max;
    const shared_hp = Math.max(0, Math.min(shared_hp_max, normalize_int(player.sharedHp, fallback_shared_hp, 0)));
    sync_player_shared_hp(state, slot, shared_hp);
  }
}

function sync_all_players_shared_mSPE(state: GameState): void {
  for (const slot of SLOT_ORDER) {
    const player = state.players[slot];
    const active = player.team[player.activeIndex] ?? player.team[0];
    const fallback_shared_mSPE = active ? normalize_int(active.mSPE, SHARED_MSPE_START, 0) : SHARED_MSPE_START;
    const shared_mSPE = Math.max(0, normalize_int(player.sharedMSPE, fallback_shared_mSPE, 0));
    sync_player_shared_mSPE(state, slot, shared_mSPE);
  }
}

function ensure_state_runtime_defaults(state: GameState): void {
  if (!state.pendingSwitch) {
    state.pendingSwitch = empty_pending();
  }
  if (!state.pendingSwitchReason) {
    state.pendingSwitchReason = empty_pending_switch_reason();
  }
  if (!state.pendingSwitchResolvedThisTurn) {
    state.pendingSwitchResolvedThisTurn = empty_pending_switch_resolved_this_turn();
  }
  if (!state.pendingWish) {
    state.pendingWish = empty_pending_wish();
  }
  if (!state.tauntUntilTurn) {
    state.tauntUntilTurn = empty_taunt_until_turn();
  }
  if (!state.activeEffectsBySlot) {
    state.activeEffectsBySlot = empty_active_effects();
  }
  if (!state.activeCursesBySlot) {
    state.activeCursesBySlot = empty_active_curses();
  }
  if (!state.activeBuffDebuffsBySlot) {
    state.activeBuffDebuffsBySlot = empty_active_buff_debuffs();
  }
  if (!state.activeHealBuffsBySlot) {
    state.activeHealBuffsBySlot = empty_active_heal_buffs();
  }
  if (!state.lastMoveIndexBySlot) {
    state.lastMoveIndexBySlot = empty_last_move_index();
  }
  if (!state.rpsScore) {
    state.rpsScore = empty_rps_score();
  }
  if (!state.mSPETelemetry) {
    state.mSPETelemetry = empty_mSPE_telemetry();
  }
  if (!state.typePassiveArmorStacks) {
    state.typePassiveArmorStacks = empty_type_passive_armor_stacks();
  }
  if (!state.typePassiveRegenStacks) {
    state.typePassiveRegenStacks = empty_type_passive_regen_stacks();
  }
  if (!state.rejuvenationStacks) {
    state.rejuvenationStacks = empty_rejuvenation_stacks();
  }
  if (!state.rejuvenationStartTurn) {
    state.rejuvenationStartTurn = empty_rejuvenation_start_turn();
  }
  if (!state.fervorChainBySlot) {
    state.fervorChainBySlot = empty_fervor_chain_by_slot();
  }
  if (!state.arenaTrapUntilTurn) {
    state.arenaTrapUntilTurn = empty_arena_trap_until_turn();
  }
  if (!state.spikesArmedByTarget) {
    state.spikesArmedByTarget = empty_spikes_armed_by_target();
  }
  for (const slot of SLOT_ORDER) {
    state.fervorChainBySlot[slot] = normalize_fervor_chain(state.fervorChainBySlot?.[slot]);
    const buffs = state.activeHealBuffsBySlot[slot];
    if (!Array.isArray(buffs)) {
      state.activeHealBuffsBySlot[slot] = [];
      continue;
    }
    if (!buffs.some((entry) => entry.id === TYPE_BUF_REGEN_HEAL_BUFF_ID)) {
      const regen_stack = Math.max(0, normalize_int(state.typePassiveRegenStacks?.[slot], 0, 0));
      if (regen_stack > 0) {
        buffs.push({
          id: TYPE_BUF_REGEN_HEAL_BUFF_ID,
          sourceSlot: slot,
          source: "type_buf_passive",
          healPerTurn: regen_stack * TYPE_PASSIVE_BUF_REGEN_PER_STACK,
          growthPerTurn: 0,
          startTurn: state.turn,
          remainingTicks: null,
          clearsOnSwitch: false
        });
      }
    }
    if (!buffs.some((entry) => entry.id === REJUVENATION_REGEN_HEAL_BUFF_ID)) {
      const stack = Math.min(
        REJUVENATION_REGEN_STACK_MAX,
        Math.max(0, normalize_int(state.rejuvenationStacks?.[slot], 0, 0))
      );
      const start_turn = Math.max(0, normalize_int(state.rejuvenationStartTurn?.[slot], 0, 0));
      if (stack > 0 && start_turn > 0) {
        const base_regen = REJUVENATION_REGEN_FLAT_PER_STACK;
        buffs.push({
          id: REJUVENATION_REGEN_HEAL_BUFF_ID,
          sourceSlot: slot,
          source: "rejuvenation",
          healPerTurn: base_regen * stack,
          growthPerTurn: 0,
          startTurn: start_turn,
          remainingTicks: null,
          clearsOnSwitch: false
        });
      }
    }
  }
  sync_all_players_shared_mSPE(state);
  refresh_active_monster_stats(state);
}

function compare_monster_type(left: MonsterType, right: MonsterType): number {
  if (left === right) {
    return 0;
  }
  if ((left === "buf" && right === "def") || (left === "def" && right === "atk") || (left === "atk" && right === "buf")) {
    return 1;
  }
  return -1;
}

type TurnActionKind = "switch" | "attack" | "none";

function action_kind_for_slot(actions: Action[], slot: PlayerSlot): TurnActionKind {
  const action = actions.find((entry) => entry.player === slot);
  if (!action) {
    return "none";
  }
  if (action.type === "switch") {
    return "switch";
  }
  if (action.type === "run") {
    return "none";
  }
  return "attack";
}

function switch_target_type_for_slot(state: GameState, actions: Action[], slot: PlayerSlot): MonsterType {
  const action = actions.find((entry) => entry.player === slot);
  if (!action || action.type !== "switch") {
    return active_monster(state.players[slot]).type;
  }
  const team = state.players[slot].team;
  if (action.targetIndex < 0 || action.targetIndex >= team.length) {
    return active_monster(state.players[slot]).type;
  }
  return team[action.targetIndex].type;
}

function award_mindgame_point(
  state: GameState,
  log: EventLog[],
  winner: PlayerSlot,
  loser: PlayerSlot,
  reason: "switch_vs_switch" | "attack_vs_switch" | "attack_vs_attack" | "switch_sovietico",
  context: Record<string, unknown>,
  score_delta: number = 1
): void {
  if (!state.rpsScore) {
    state.rpsScore = empty_rps_score();
  }
  const normalized_delta = Math.max(1, normalize_int(score_delta, 1, 1));
  const player1_before = state.rpsScore.player1 ?? 0;
  const player2_before = state.rpsScore.player2 ?? 0;
  state.rpsScore[winner] = (state.rpsScore[winner] ?? 0) + normalized_delta;
  state.rpsScore[loser] = (state.rpsScore[loser] ?? 0) - normalized_delta;
  log.push({
    type: "mindgame_bonus_ready",
    turn: state.turn,
    summary: `${winner} won mindgame (${reason}${normalized_delta > 1 ? ` x${normalized_delta}` : ""})`,
    data: {
      winner,
      loser,
      reason,
      scoreDelta: normalized_delta,
      ...context
    }
  });
  log.push({
    type: "rps_score_update",
    turn: state.turn,
    summary: `rps score updated (${winner} +${normalized_delta}, ${loser} -${normalized_delta})`,
    data: {
      winner,
      loser,
      player1Before: player1_before,
      player1After: state.rpsScore.player1,
      player2Before: player2_before,
      player2After: state.rpsScore.player2
    }
  });
}

function apply_mindgame_bonus_event(state: GameState, log: EventLog[], actions: Action[]): void {
  const p1_kind = action_kind_for_slot(actions, "player1");
  const p2_kind = action_kind_for_slot(actions, "player2");

  if (p1_kind === "none" || p2_kind === "none") {
    return;
  }

  if (p1_kind === "switch" && p2_kind === "switch") {
    const p1_type = switch_target_type_for_slot(state, actions, "player1");
    const p2_type = switch_target_type_for_slot(state, actions, "player2");
    const type_cmp = compare_monster_type(p1_type, p2_type);
    if (type_cmp === 0) {
      return;
    }
    const winner: PlayerSlot = type_cmp > 0 ? "player1" : "player2";
    const loser: PlayerSlot = winner === "player1" ? "player2" : "player1";
    award_mindgame_point(state, log, winner, loser, "switch_vs_switch", {
      player1Type: p1_type,
      player2Type: p2_type
    });
    return;
  }

  if (p1_kind !== p2_kind) {
    const winner: PlayerSlot = p1_kind === "attack" ? "player1" : "player2";
    const loser: PlayerSlot = winner === "player1" ? "player2" : "player1";
    award_mindgame_point(state, log, winner, loser, "attack_vs_switch", {
      player1Action: p1_kind,
      player2Action: p2_kind
    });
    return;
  }

  const p1_type = active_monster(state.players.player1).type;
  const p2_type = active_monster(state.players.player2).type;
  const type_cmp = compare_monster_type(p1_type, p2_type);
  if (type_cmp === 0) {
    return;
  }
  const winner: PlayerSlot = type_cmp > 0 ? "player1" : "player2";
  const loser: PlayerSlot = winner === "player1" ? "player2" : "player1";
  award_mindgame_point(state, log, winner, loser, "attack_vs_attack", {
    player1Type: p1_type,
    player2Type: p2_type
  });
}

function apply_switch_sovietico_predict_bonus(
  state: GameState,
  log: EventLog[],
  resolved_this_turn: Record<PlayerSlot, boolean>,
  hp_changed: WeakSet<MonsterState>,
  took_damage_this_turn: Record<PlayerSlot, boolean>,
  damage_taken_this_turn: Record<PlayerSlot, number>,
  incoming_damage_multiplier_percent: Record<PlayerSlot, number>
): boolean {
  if (!resolved_this_turn.player1 || !resolved_this_turn.player2) {
    return false;
  }

  const p1_type = active_monster(state.players.player1).type;
  const p2_type = active_monster(state.players.player2).type;
  const type_cmp = compare_monster_type(p1_type, p2_type);
  if (type_cmp === 0) {
    log.push({
      type: "mindgame_bonus_ready",
      turn: state.turn,
      summary: "Switch Sovietico predict resolved in tie (no score/passive bonus)",
      data: {
        reason: "switch_sovietico",
        player1Type: p1_type,
        player2Type: p2_type,
        scoreDelta: 0
      }
    });
    return true;
  }

  const winner: PlayerSlot = type_cmp > 0 ? "player1" : "player2";
  const loser: PlayerSlot = winner === "player1" ? "player2" : "player1";
  award_mindgame_point(
    state,
    log,
    winner,
    loser,
    "switch_sovietico",
    { player1Type: p1_type, player2Type: p2_type, passiveRepeats: 2 },
    2
  );

  const switched: Record<PlayerSlot, boolean> = { player1: true, player2: true };
  apply_simultaneous_switch_passives(
    state,
    log,
    switched,
    hp_changed,
    took_damage_this_turn,
    damage_taken_this_turn,
    incoming_damage_multiplier_percent,
    2
  );
  return true;
}

function apply_spikes_on_switch(
  state: GameState,
  log: EventLog[],
  slot: PlayerSlot,
  hp_changed?: WeakSet<MonsterState>,
  took_damage_this_turn?: Record<PlayerSlot, boolean>,
  damage_taken_this_turn?: Record<PlayerSlot, number>,
  incoming_damage_multiplier_percent?: Record<PlayerSlot, number>
): void {
  if (!(state.spikesArmedByTarget?.[slot] ?? false)) {
    return;
  }
  state.spikesArmedByTarget[slot] = false;
  const hp_changed_ref = hp_changed ?? new WeakSet<MonsterState>();
  const took_damage_ref = took_damage_this_turn ?? { player1: false, player2: false };
  const damage_taken_ref = damage_taken_this_turn ?? { player1: 0, player2: 0 };
  const target_player = state.players[slot];
  const target = active_monster(target_player);
  const damage_attempt = Math.max(0, mul_div_round(target_player.sharedHpMax, 1, 20));
  const result = apply_damage_with_endure(
    state,
    log,
    "switch",
    slot,
    target,
    damage_attempt,
    hp_changed_ref,
    took_damage_ref,
    undefined,
    damage_taken_ref,
    incoming_damage_multiplier_percent
  );
  log.push({
    type: "spikes_trigger",
    turn: state.turn,
    phase: "switch",
    summary:
      result.applied > 0
        ? `${target.name} took ${result.applied} from Spikes on switch`
        : `${target.name} triggered Spikes on switch (no damage)`,
    data: {
      slot: other_slot(slot),
      targetSlot: slot,
      target: target.id,
      damage: result.applied,
      before: result.before,
      after: result.after
    }
  });
}

function apply_simultaneous_switch_passives(
  state: GameState,
  log: EventLog[],
  switched_this_turn: Record<PlayerSlot, boolean>,
  hp_changed: WeakSet<MonsterState>,
  took_damage_this_turn: Record<PlayerSlot, boolean>,
  damage_taken_this_turn?: Record<PlayerSlot, number>,
  incoming_damage_multiplier_percent?: Record<PlayerSlot, number>,
  passive_multiplier: number = 1
): void {
  if (!switched_this_turn.player1 || !switched_this_turn.player2) {
    return;
  }
  const passive_mult = Math.max(1, normalize_int(passive_multiplier, 1, 1));
  const p1_type = active_monster(state.players.player1).type;
  const p2_type = active_monster(state.players.player2).type;
  const type_cmp = compare_monster_type(p1_type, p2_type);
  if (type_cmp === 0) {
    return;
  }

  const winner: PlayerSlot = type_cmp > 0 ? "player1" : "player2";
  const loser: PlayerSlot = winner === "player1" ? "player2" : "player1";
  const winner_player = state.players[winner];
  const loser_player = state.players[loser];
  if (winner_player.sharedHp <= 0 || loser_player.sharedHp <= 0) {
    return;
  }

  const winner_mon = active_monster(winner_player);
  const loser_mon = active_monster(loser_player);

  if (winner_mon.type === "atk") {
    const true_damage = TYPE_PASSIVE_ATK_TRUE_DAMAGE * passive_mult;
    const damage_result = apply_damage_with_endure(
      state,
      log,
      "switch",
      loser,
      loser_mon,
      true_damage,
      hp_changed,
      took_damage_this_turn,
      { ignoreArmor: true, source: "type_passive_atk" },
      damage_taken_this_turn,
      incoming_damage_multiplier_percent
    );
    log.push({
      type: "passive_trigger",
      turn: state.turn,
      phase: "switch",
      summary: `${winner_mon.name} activated ATK passive (true damage ${damage_result.applied}${passive_mult > 1 ? `, x${passive_mult}` : ""})`,
      data: {
        slot: winner,
        targetSlot: loser,
        source: winner_mon.id,
        target: loser_mon.id,
        passive: "type_atk_true_damage",
        damage: damage_result.applied,
        passiveMultiplier: passive_mult
      }
    });
    log.push({
      type: "damage",
      turn: state.turn,
      phase: "switch",
      summary: `${winner} dealt ${damage_result.applied} to ${loser_mon.name}`,
      data: {
        slot: winner,
        targetSlot: loser,
        source: winner_mon.id,
        target: loser_mon.id,
        damage: damage_result.applied,
        before: damage_result.before,
        after: damage_result.after,
        damageType: "true"
      }
    });
    return;
  }

  if (winner_mon.type === "def") {
    const before_stack = type_passive_armor_stack(state, winner);
    const after_stack = Math.min(TYPE_PASSIVE_DEF_ARMOR_STACK_MAX, before_stack + passive_mult);
    state.typePassiveArmorStacks[winner] = after_stack;
    log.push({
      type: "passive_trigger",
      turn: state.turn,
      phase: "switch",
      summary: `${winner_mon.name} activated DEF passive (Clear Body [Instant] + Armor ${after_stack * TYPE_PASSIVE_DEF_ARMOR_REDUCTION_PER_STACK_PERCENT}%${
        passive_mult > 1 ? `, x${passive_mult} stack gain` : ""
      })`,
      data: {
        slot: winner,
        source: winner_mon.id,
        passive: "type_def_armor_stack",
        stackBefore: before_stack,
        stackAfter: after_stack,
        armorReductionPercent: after_stack * TYPE_PASSIVE_DEF_ARMOR_REDUCTION_PER_STACK_PERCENT,
        passiveMultiplier: passive_mult
      }
    });
    return;
  }

  const existing_regen = heal_buff_state(state, winner, TYPE_BUF_REGEN_HEAL_BUFF_ID);
  const before_heal_per_turn = existing_regen?.healPerTurn ?? 0;
  const added_heal_per_turn = TYPE_PASSIVE_BUF_REGEN_PER_STACK * passive_mult;
  const regen_buff = upsert_heal_buff(state, log, winner, winner, "type_buf_passive", {
    id: TYPE_BUF_REGEN_HEAL_BUFF_ID,
    source: "type_buf_passive",
    healPerTurn: added_heal_per_turn,
    growthPerTurn: 0,
    startTurn: state.turn,
    remainingTicks: null,
    clearsOnSwitch: false
  });
  const after_heal_per_turn = regen_buff.healPerTurn;
  const before_stack = Math.max(0, Math.floor(before_heal_per_turn / TYPE_PASSIVE_BUF_REGEN_PER_STACK));
  const after_stack = Math.max(0, Math.floor(after_heal_per_turn / TYPE_PASSIVE_BUF_REGEN_PER_STACK));
  state.typePassiveRegenStacks[winner] = after_stack;
  log.push({
    type: "passive_trigger",
    turn: state.turn,
    phase: "switch",
    summary: `${winner_mon.name} activated BUF passive (regen stack ${after_stack}${
      passive_mult > 1 ? `, x${passive_mult} stack gain` : ""
    })`,
    data: {
      slot: winner,
      source: winner_mon.id,
      passive: "type_buf_regen_stack",
      stackBefore: before_stack,
      stackAfter: after_stack,
      healPerTurnBefore: before_heal_per_turn,
      healPerTurnAfter: after_heal_per_turn,
      healPerTurnDelta: added_heal_per_turn,
      passiveMultiplier: passive_mult
    }
  });
}

function end_match_with_winner(
  state: GameState,
  log: EventLog[],
  winner: PlayerSlot,
  summary: string,
  data?: Record<string, unknown>,
  end_reason?: MatchEndReason
): void {
  state.status = "ended";
  state.winner = winner;
  if (end_reason) {
    state.endReason = end_reason;
  }
  delete state.mSPESlots;
  log.push({
    type: "match_end",
    turn: state.turn,
    summary,
    data: { winner, ...(data ?? {}) }
  });
}

function end_match_draw(
  state: GameState,
  log: EventLog[],
  summary: string,
  data?: Record<string, unknown>,
  end_reason?: MatchEndReason
): void {
  state.status = "ended";
  delete state.winner;
  if (end_reason) {
    state.endReason = end_reason;
  }
  delete state.mSPESlots;
  log.push({
    type: "match_end",
    turn: state.turn,
    summary,
    data: { ...(data ?? {}) }
  });
}

function check_zero_hp_match_result(state: GameState, log: EventLog[]): MatchProgress {
  const p1_hp = state.players.player1.sharedHp;
  const p2_hp = state.players.player2.sharedHp;
  if (p1_hp > 0 && p2_hp > 0) {
    return "continue";
  }
  if (p1_hp <= 0 && p2_hp > 0) {
    end_match_with_winner(state, log, "player2", "player2 wins (enemy shared HP reached 0)", {
      player1Hp: p1_hp,
      player2Hp: p2_hp
    }, "hp_zero");
    return "ended";
  }
  if (p2_hp <= 0 && p1_hp > 0) {
    end_match_with_winner(state, log, "player1", "player1 wins (enemy shared HP reached 0)", {
      player1Hp: p1_hp,
      player2Hp: p2_hp
    }, "hp_zero");
    return "ended";
  }
  end_match_draw(state, log, "draw (both sides reached 0 HP)", {
    player1Hp: p1_hp,
    player2Hp: p2_hp
  }, "hp_zero");
  return "ended";
}

function effective_attack_for_slot(state: GameState, slot: PlayerSlot, monster: MonsterState): number {
  refresh_active_monster_stats_for_slot(state, slot);
  const effective_stage = effective_attack_stage_for_monster(state, slot, monster);
  if (has_effect(state, slot, "weakness")) {
    const weakened_stage = clamp_stat_stage(effective_stage - 2);
    const attack_delta = total_delta_percent_from_buff_debuffs(state, slot, "attack", monster.id);
    const attack_base_after_percent = stat_value_from_delta_percent(monster.baseAttack, attack_delta);
    return attack_from_stage(attack_base_after_percent, weakened_stage);
  }
  return monster.attack;
}

function effective_defense_for_slot(state: GameState, slot: PlayerSlot, monster: MonsterState): number {
  refresh_active_monster_stats_for_slot(state, slot);
  if (has_effect(state, slot, "deterioration")) {
    return 0;
  }
  return monster.defense;
}

function effective_speed_for_slot(state: GameState, slot: PlayerSlot, monster: MonsterState): number {
  refresh_active_monster_stats_for_slot(state, slot);
  if (has_effect(state, slot, "paralyse")) {
    return 0;
  }
  return monster.speed;
}

function build_mSPE_telemetry_entry(state: GameState, slot: PlayerSlot): MSPETelemetry {
  const enemy_slot = other_slot(slot);
  const effective_mSPE = Math.max(0, normalize_int(state.players[slot].sharedMSPE, SHARED_MSPE_START, 0));
  const enemy_effective_mSPE = Math.max(
    0,
    normalize_int(state.players[enemy_slot].sharedMSPE, SHARED_MSPE_START, 0)
  );
  const divisor = Math.max(1, enemy_effective_mSPE);
  const gap_percent = mul_div_round(effective_mSPE - enemy_effective_mSPE, 100, divisor);
  const evade_ready = effective_mSPE >= MSPE_VALUE_GOAL;
  const gap_ready = gap_percent >= MSPE_GAP_GOAL_PERCENT;
  return {
    effectiveMSPE: effective_mSPE,
    mSPEGoal: MSPE_VALUE_GOAL,
    mSPEReady: evade_ready,
    gapPercent: gap_percent,
    gapGoalPercent: MSPE_GAP_GOAL_PERCENT,
    gapReady: gap_ready,
    canMSPE: evade_ready || gap_ready
  };
}

function refresh_mSPE_telemetry(state: GameState): void {
  ensure_state_runtime_defaults(state);
  state.mSPETelemetry.player1 = build_mSPE_telemetry_entry(state, "player1");
  state.mSPETelemetry.player2 = build_mSPE_telemetry_entry(state, "player2");
}

function check_mSPE_match_result(state: GameState, log: EventLog[]): MatchProgress {
  refresh_mSPE_telemetry(state);
  if (state.status !== "running") {
    return state.status === "ended" ? "ended" : "continue";
  }
  const mSPE_slots = SLOT_ORDER.filter((slot) => state.mSPETelemetry[slot].canMSPE);
  if (mSPE_slots.length === 0) {
    return "continue";
  }

  state.status = "ended";
  state.endReason = "mSPE_escape";
  state.mSPESlots = mSPE_slots.slice();
  delete state.winner;

  const summary =
    mSPE_slots.length >= 2
      ? "double technical escape (both players satisfied mSPE condition)"
      : `${mSPE_slots[0]} escaped technically (mSPE condition met)`;
  log.push({
    type: "match_end",
    turn: state.turn,
    summary,
    data: {
      reason: "mSPE_escape",
      mSPESlots: mSPE_slots.slice(),
      telemetry: {
        player1: { ...state.mSPETelemetry.player1 },
        player2: { ...state.mSPETelemetry.player2 }
      }
    }
  });
  return "ended";
}

function initiative_stat_value(
  state: GameState,
  slot: PlayerSlot,
  monster: MonsterState,
  key: keyof Pick<MonsterState, "speed" | "attack" | "hp" | "defense">
): number {
  if (key === "speed") {
    return effective_speed_for_slot(state, slot, monster);
  }
  if (key === "attack") {
    return effective_attack_for_slot(state, slot, monster);
  }
  if (key === "defense") {
    return effective_defense_for_slot(state, slot, monster);
  }
  return monster.hp;
}

function compare_initiative(
  state: GameState,
  a_slot: PlayerSlot,
  b_slot: PlayerSlot,
  a: MonsterState,
  b: MonsterState,
  stats: Phase["initiative"]
): number {
  for (const key of stats) {
    const diff = initiative_stat_value(state, a_slot, a, key) - initiative_stat_value(state, b_slot, b, key);
    if (diff !== 0) {
      return diff;
    }
  }
  return 0;
}

function is_alive(monster: MonsterState): boolean {
  return monster.maxHp > 0;
}

function for_each_player(state: GameState, fn: (player: PlayerState) => void): void {
  for (const slot of SLOT_ORDER) {
    fn(state.players[slot]);
  }
}

function reset_protect_flags(state: GameState): void {
  for_each_player(state, (player) => {
    for (const monster of player.team) {
      monster.protectActiveThisTurn = false;
      monster.specialProtectActiveThisTurn = false;
      monster.endureActiveThisTurn = false;
      monster.baitActiveThisTurn = false;
    }
  });
}

function decrement_cooldowns(state: GameState): void {
  for_each_player(state, (player) => {
    for (const monster of player.team) {
      const guard_cooldown = Math.max(monster.protectCooldownTurns, monster.endureCooldownTurns);
      if (guard_cooldown > 0) {
        const next_guard_cooldown = guard_cooldown - 1;
        monster.protectCooldownTurns = next_guard_cooldown;
        monster.endureCooldownTurns = next_guard_cooldown;
      }
      const special_protect_cooldown = Math.max(0, normalize_int(monster.specialProtectCooldownTurns, 0, 0));
      if (special_protect_cooldown > 0) {
        monster.specialProtectCooldownTurns = special_protect_cooldown - 1;
      }
    }
  });
}

function apply_pending_wish(state: GameState, log: EventLog[], slot: PlayerSlot, hp_changed: WeakSet<MonsterState>): void {
  if ((state.pendingWish?.[slot] ?? null) !== state.turn) {
    return;
  }

  const player = state.players[slot];
  const target = active_monster(player);
  const before_hp = player.sharedHp;
  const wish_heal = Math.max(0, mul_div_round(player.sharedHpMax, 1, 2));
  const after_hp = Math.min(player.sharedHpMax, Math.max(0, before_hp + wish_heal));
  state.pendingWish[slot] = null;

  if (after_hp !== before_hp) {
    sync_player_shared_hp(state, slot, after_hp);
    hp_changed.add(target);
    log.push({
      type: "wish_heal",
      turn: state.turn,
      phase: END_PHASE_ID,
      summary: `${target.name} recebeu Wish (+${wish_heal} por maxHp: ${before_hp} -> ${after_hp})`,
      data: { slot, target: target.id, before: before_hp, after: after_hp, amount: wish_heal, basedOn: "maxHp" }
    });
  } else {
    log.push({
      type: "wish_heal",
      turn: state.turn,
      phase: END_PHASE_ID,
      summary: `${target.name} recebeu Wish (sem efeito: +${wish_heal} por maxHp, ${before_hp} -> ${after_hp})`,
      data: { slot, target: target.id, before: before_hp, after: after_hp, amount: wish_heal, basedOn: "maxHp" }
    });
  }
}

function apply_rejuvenation_reactive_heal_end_turn(
  state: GameState,
  log: EventLog[],
  slot: PlayerSlot,
  hp_changed: WeakSet<MonsterState>,
  rejuvenation_used_this_turn: Record<PlayerSlot, boolean>,
  damage_taken_this_turn: Record<PlayerSlot, number>
): void {
  if (!rejuvenation_used_this_turn[slot]) {
    return;
  }
  const player = state.players[slot];
  const target = active_monster(player);
  const damage_taken = Math.max(0, normalize_int(damage_taken_this_turn[slot], 0, 0));
  if (damage_taken <= 0) {
    log.push({
      type: "rejuvenation_reactive_heal",
      turn: state.turn,
      phase: END_PHASE_ID,
      summary: `${target.name} used Rejuvenation but took no damage this turn`,
      data: { slot, target: target.id, damageTaken: 0, healApplied: 0 }
    });
    return;
  }
  const heal_attempt = Math.max(0, mul_div_floor(damage_taken, 1, 2));
  const result = apply_heal_amount(state, slot, hp_changed, heal_attempt);
  log.push({
    type: "rejuvenation_reactive_heal",
    turn: state.turn,
    phase: END_PHASE_ID,
    summary: `${target.name} healed ${result.healed} from Rejuvenation (50% of damage taken)`,
    data: {
      slot,
      target: target.id,
      damageTaken: damage_taken,
      healAttempted: heal_attempt,
      healApplied: result.healed,
      before: result.before,
      after: result.after
    }
  });
}

function apply_rejuvenation_regen_end_turn(
  state: GameState,
  log: EventLog[],
  slot: PlayerSlot,
  hp_changed: WeakSet<MonsterState>
): void {
  apply_heal_buffs_end_turn_by_id(state, log, slot, hp_changed, REJUVENATION_REGEN_HEAL_BUFF_ID);
}

function apply_type_passive_regen_end_turn(
  state: GameState,
  log: EventLog[],
  slot: PlayerSlot,
  hp_changed: WeakSet<MonsterState>
): void {
  apply_heal_buffs_end_turn_by_id(state, log, slot, hp_changed, TYPE_BUF_REGEN_HEAL_BUFF_ID);
}

function clear_curses_on_target_switch(state: GameState, log: EventLog[], target_slot: PlayerSlot): void {
  ensure_state_runtime_defaults(state);
  const active_curses = state.activeCursesBySlot[target_slot];
  if (!Array.isArray(active_curses) || active_curses.length === 0) {
    return;
  }
  const kept: ActiveCurseState[] = [];
  for (const curse of active_curses) {
    if (curse.id === "sekyps") {
      kept.push(curse);
      continue;
    }
    const ended_type = curse.id === "leech_seed" ? "leech_end" : "curse_end";
    log.push({
      type: ended_type,
      turn: state.turn,
      summary:
        curse.id === "leech_seed"
          ? `Leech Seed ended on ${target_slot} after switch`
          : `${curse_label(curse.id)} ended on ${target_slot} after switch`,
      data: { slot: target_slot, source: curse.sourceSlot, curse: curse.id, stacks: curse.stacks, reason: "switch" }
    });
  }
  state.activeCursesBySlot[target_slot] = kept;
}

function clear_buff_debuffs_on_target_switch(state: GameState, log: EventLog[], target_slot: PlayerSlot): void {
  ensure_state_runtime_defaults(state);
  const active = state.activeBuffDebuffsBySlot[target_slot];
  if (!Array.isArray(active) || active.length === 0) {
    return;
  }
  const kept = active.filter((entry) => entry.clearsOnSwitch !== true);
  const removed = active.length - kept.length;
  if (removed <= 0) {
    return;
  }
  state.activeBuffDebuffsBySlot[target_slot] = kept;
  refresh_active_monster_stats_for_slot(state, target_slot);
  log.push({
    type: "buff_debuff_end",
    turn: state.turn,
    summary: `${target_slot} cleared ${removed} buff/debuff modifier${removed === 1 ? "" : "s"} on switch`,
    data: { slot: target_slot, removed, reason: "switch" }
  });
}

function clear_heal_buffs_on_target_switch(state: GameState, log: EventLog[], target_slot: PlayerSlot): void {
  ensure_state_runtime_defaults(state);
  const active = state.activeHealBuffsBySlot[target_slot];
  if (!Array.isArray(active) || active.length === 0) {
    return;
  }
  const kept = active.filter((entry) => entry.clearsOnSwitch !== true);
  const removed = active.length - kept.length;
  if (removed <= 0) {
    return;
  }
  state.activeHealBuffsBySlot[target_slot] = kept;
  log.push({
    type: "heal_buff_end",
    turn: state.turn,
    summary: `${target_slot} cleared ${removed} heal buff${removed === 1 ? "" : "s"} on switch`,
    data: { slot: target_slot, removed, reason: "switch" }
  });
}

function clear_buff_debuffs_for_stat(state: GameState, slot: PlayerSlot, stat: BuffDebuffStat): number {
  ensure_state_runtime_defaults(state);
  const before = state.activeBuffDebuffsBySlot[slot];
  if (!Array.isArray(before) || before.length === 0) {
    return 0;
  }
  const filtered = before.filter((entry) => entry.stat !== stat || entry.clearsOnSwitch !== true);
  const removed = before.length - filtered.length;
  if (removed > 0) {
    state.activeBuffDebuffsBySlot[slot] = filtered;
    refresh_active_monster_stats_for_slot(state, slot);
  }
  return removed;
}

function apply_curse_end_turn(
  state: GameState,
  log: EventLog[],
  hp_changed: WeakSet<MonsterState>,
  switched_this_turn: Record<PlayerSlot, boolean>
): void {
  ensure_state_runtime_defaults(state);
  for (const target_slot of SLOT_ORDER) {
    const curses = state.activeCursesBySlot[target_slot];
    if (!Array.isArray(curses) || curses.length === 0) {
      continue;
    }
    const target_player = state.players[target_slot];
    const target = active_monster(target_player);
    if (!is_alive(target)) {
      continue;
    }

    for (const curse of curses) {
      if (curse.id === "leech_seed") {
        const source_slot = curse.sourceSlot ?? other_slot(target_slot);
        const target_before = target_player.sharedHp;
        const drained_base = mul_div_floor(target_player.sharedHpMax, 1, 8);
        const drained_attempt = Math.max(0, drained_base * Math.max(1, curse.stacks));
        const drained = Math.min(target_before, drained_attempt);
        const target_after = target_before - drained;
        if (drained <= 0) {
          continue;
        }
        sync_player_shared_hp(state, target_slot, target_after);
        hp_changed.add(target);
        log.push({
          type: "leech_drain",
          turn: state.turn,
          phase: END_PHASE_ID,
          summary: `${target.name} lost ${drained} HP from Leech Seed`,
          data: {
            slot: source_slot,
            targetSlot: target_slot,
            source: source_slot,
            target: target.id,
            damage: drained,
            stacks: curse.stacks,
            before: target_before,
            after: target_after
          }
        });

        const source_player = state.players[source_slot];
        const receiver = active_monster(source_player);
        if (is_alive(receiver)) {
          const heal_before = source_player.sharedHp;
          const heal_after = Math.min(source_player.sharedHpMax, source_player.sharedHp + drained);
          const healed = Math.max(0, heal_after - heal_before);
          if (healed > 0) {
            sync_player_shared_hp(state, source_slot, heal_after);
            hp_changed.add(receiver);
            log.push({
              type: "leech_heal",
              turn: state.turn,
              phase: END_PHASE_ID,
              summary: `${receiver.name} healed ${healed} HP from Leech Seed`,
              data: {
                slot: source_slot,
                source: source_slot,
                targetSlot: target_slot,
                target: target.id,
                heal: healed,
                stacks: curse.stacks,
                before: heal_before,
                after: heal_after
              }
            });
          }
        }
        continue;
      }

      if (curse.id === "sekyps") {
        if (switched_this_turn[target_slot]) {
          continue;
        }
        const current_stack = Math.max(1, normalize_int(curse.stacks, 1, 1));
        const applied_this_turn = typeof curse.appliedTurn === "number" && curse.appliedTurn === state.turn;
        const ticking_stack = applied_this_turn ? current_stack - 1 : current_stack;
        if (ticking_stack <= 0) {
          continue;
        }
        const source_slot = curse.sourceSlot ?? other_slot(target_slot);
        const damage_amount = ticking_stack * SEKYPS_DAMAGE_PER_STACK;
        const target_before = target_player.sharedHp;
        const damage = Math.min(target_before, Math.max(0, damage_amount));
        const target_after = target_before - damage;
        if (damage <= 0) {
          continue;
        }
        sync_player_shared_hp(state, target_slot, target_after);
        hp_changed.add(target);
        log.push({
          type: "sekyps_tick",
          turn: state.turn,
          phase: END_PHASE_ID,
          summary: `${target.name} lost ${damage} HP from Sekyps (stack ${ticking_stack})`,
          data: {
            slot: source_slot,
            targetSlot: target_slot,
            source: source_slot,
            target: target.id,
            damage,
            damageAmount: damage_amount,
            stack: ticking_stack,
            totalStack: current_stack,
            nextStack: current_stack,
            nextDamageAmount: current_stack * SEKYPS_DAMAGE_PER_STACK,
            appliedThisTurn: applied_this_turn,
            before: target_before,
            after: target_after
          }
        });
        continue;
      }

      // Other curse rules are intentionally left as future extensions.
      continue;
    }
  }
}

function maybe_end_match_by_turn_limit(state: GameState, log: EventLog[]): void {
  if (state.status === "ended") {
    return;
  }
  const base_turn_limit = Math.max(1, normalize_int(state.baseTurnLimit, BASE_TURN_LIMIT, 1));
  state.baseTurnLimit = base_turn_limit;

  if (state.turn < base_turn_limit) {
    return;
  }

  const p1_hp = state.players.player1.sharedHp;
  const p2_hp = state.players.player2.sharedHp;
  if (p1_hp !== p2_hp) {
    const winner: PlayerSlot = p1_hp > p2_hp ? "player1" : "player2";
    end_match_with_winner(
      state,
      log,
      winner,
      `${winner} wins (higher shared HP after ${base_turn_limit} turns)`,
      { player1Hp: p1_hp, player2Hp: p2_hp },
      "turn_limit"
    );
    return;
  }

  end_match_draw(state, log, `draw after ${base_turn_limit} turns (equal shared HP)`, {
    player1Hp: p1_hp,
    player2Hp: p2_hp
  }, "turn_limit");
}

function apply_focus_punch_end_turn(
  state: GameState,
  log: EventLog[],
  hp_changed: WeakSet<MonsterState>,
  focus_punch_pending: Record<PlayerSlot, boolean>,
  took_damage_this_turn: Record<PlayerSlot, boolean>,
  damage_taken_this_turn: Record<PlayerSlot, number>,
  incoming_damage_multiplier_percent: Record<PlayerSlot, number>
): void {
  const spec = move_spec("focus_punch");
  for (const slot of SLOT_ORDER) {
    if (!focus_punch_pending[slot]) {
      continue;
    }
    const attacker = active_monster(state.players[slot]);
    if (!is_alive(attacker)) {
      log.push({
        type: "focus_punch_fail",
        turn: state.turn,
        phase: END_PHASE_ID,
        summary: `${slot} lost focus (fainted before Focus Punch)`,
        data: { slot, reason: "fainted" }
      });
      continue;
    }
    if (took_damage_this_turn[slot]) {
      log.push({
        type: "focus_punch_fail",
        turn: state.turn,
        phase: END_PHASE_ID,
        summary: `${attacker.name} lost focus and Focus Punch failed`,
        data: { slot, reason: "took_damage_before_attack" }
      });
      continue;
    }
    apply_damage_move(
      state,
      log,
      slot,
      spec,
      hp_changed,
      END_PHASE_ID,
      took_damage_this_turn,
      damage_taken_this_turn,
      incoming_damage_multiplier_percent
    );
  }
}

function apply_pending_happiness_end_turn(
  state: GameState,
  log: EventLog[],
  pending_happiness_apply_by_slot: Record<PlayerSlot, boolean>
): void {
  for (const slot of SLOT_ORDER) {
    if (!pending_happiness_apply_by_slot[slot]) {
      continue;
    }
    const target = active_monster(state.players[slot]);
    if (!is_alive(target)) {
      continue;
    }
    upsert_curse(state, log, slot, "happiness", slot, "fervor", {
      remainingTurns: HAPPINESS_DURATION_AFTER_ENDING_APPLY
    });
  }
}

function apply_end_turn_effect(
  state: GameState,
  log: EventLog[],
  hp_changed: WeakSet<MonsterState>,
  effect_id: EndTurnEffectId,
  focus_punch_pending: Record<PlayerSlot, boolean>,
  took_damage_this_turn: Record<PlayerSlot, boolean>,
  switched_this_turn: Record<PlayerSlot, boolean>,
  rejuvenation_used_this_turn: Record<PlayerSlot, boolean>,
  damage_taken_this_turn: Record<PlayerSlot, number>,
  incoming_damage_multiplier_percent: Record<PlayerSlot, number>,
  pending_happiness_apply_by_slot: Record<PlayerSlot, boolean>
): void {
  if (effect_id === "focus_punch") {
    apply_focus_punch_end_turn(
      state,
      log,
      hp_changed,
      focus_punch_pending,
      took_damage_this_turn,
      damage_taken_this_turn,
      incoming_damage_multiplier_percent
    );
    return;
  }
  if (effect_id === "rejuvenation_reactive") {
    for (const slot of SLOT_ORDER) {
      apply_rejuvenation_reactive_heal_end_turn(
        state,
        log,
        slot,
        hp_changed,
        rejuvenation_used_this_turn,
        damage_taken_this_turn
      );
    }
    return;
  }
  if (effect_id === "wish") {
    for (const slot of SLOT_ORDER) {
      apply_pending_wish(state, log, slot, hp_changed);
    }
    return;
  }
  if (effect_id === "leech_life") {
    apply_curse_end_turn(state, log, hp_changed, switched_this_turn);
    return;
  }
  if (effect_id === "rejuvenation_regen") {
    for (const slot of SLOT_ORDER) {
      apply_rejuvenation_regen_end_turn(state, log, slot, hp_changed);
    }
    return;
  }
  if (effect_id === "type_regen") {
    for (const slot of SLOT_ORDER) {
      apply_type_passive_regen_end_turn(state, log, slot, hp_changed);
    }
    return;
  }
  apply_pending_happiness_end_turn(state, log, pending_happiness_apply_by_slot);
}

function apply_end_turn_phase(
  state: GameState,
  log: EventLog[],
  hp_changed: WeakSet<MonsterState>,
  focus_punch_pending: Record<PlayerSlot, boolean>,
  took_damage_this_turn: Record<PlayerSlot, boolean>,
  switched_this_turn: Record<PlayerSlot, boolean>,
  rejuvenation_used_this_turn: Record<PlayerSlot, boolean>,
  damage_taken_this_turn: Record<PlayerSlot, number>,
  incoming_damage_multiplier_percent: Record<PlayerSlot, number>,
  pending_happiness_apply_by_slot: Record<PlayerSlot, boolean>
): MatchProgress {
  for (const effect_id of END_TURN_EFFECT_ORDER) {
    apply_end_turn_effect(
      state,
      log,
      hp_changed,
      effect_id,
      focus_punch_pending,
      took_damage_this_turn,
      switched_this_turn,
      rejuvenation_used_this_turn,
      damage_taken_this_turn,
      incoming_damage_multiplier_percent,
      pending_happiness_apply_by_slot
    );
    const progress = check_zero_hp_match_result(state, log);
    if (progress !== "continue") {
      return progress;
    }
  }
  return "continue";
}

function minimum_endure_hp(monster: MonsterState): number {
  return Math.max(1, mul_div_ceil(monster.maxHp, 1, 100));
}

function apply_damage_with_endure(
  state: GameState,
  log: EventLog[],
  phase: string,
  slot: PlayerSlot,
  monster: MonsterState,
  attempted_damage: number,
  hp_changed: WeakSet<MonsterState>,
  took_damage_this_turn: Record<PlayerSlot, boolean>,
  options?: { ignoreArmor?: boolean; source?: string },
  damage_taken_this_turn?: Record<PlayerSlot, number>,
  incoming_damage_multiplier_percent?: Record<PlayerSlot, number>
): { before: number; after: number; applied: number } {
  const before = state.players[slot].sharedHp;
  if (before <= 0 || attempted_damage <= 0) {
    return { before, after: before, applied: 0 };
  }
  const incoming_multiplier_raw = incoming_damage_multiplier_percent ? incoming_damage_multiplier_percent[slot] : 100;
  const incoming_multiplier = is_attack_damage_phase(phase)
    ? Math.max(0, normalize_int(incoming_multiplier_raw, 100, 0))
    : 100;
  const adjusted_attempted_damage =
    incoming_multiplier === 100
      ? attempted_damage
      : Math.max(0, mul_div_floor(attempted_damage, incoming_multiplier, 100));

  const ignore_armor = !!options?.ignoreArmor;
  const armor_stack = ignore_armor ? 0 : type_passive_armor_stack(state, slot);
  const armor_reduction_percent = Math.max(
    0,
    Math.min(99, armor_stack * TYPE_PASSIVE_DEF_ARMOR_REDUCTION_PER_STACK_PERCENT)
  );
  let damage_after_armor = adjusted_attempted_damage;
  if (!ignore_armor && armor_reduction_percent > 0) {
    damage_after_armor = Math.max(0, mul_div_floor(adjusted_attempted_damage, 100 - armor_reduction_percent, 100));
    const mitigated = Math.max(0, adjusted_attempted_damage - damage_after_armor);
    if (mitigated > 0) {
      log.push({
        type: "armor_block",
        turn: state.turn,
        phase,
        summary: `${monster.name} armor mitigated ${mitigated} damage`,
        data: {
          slot,
          target: monster.id,
          source: options?.source ?? null,
          armorStack: armor_stack,
          armorReductionPercent: armor_reduction_percent,
          damageBeforeArmor: adjusted_attempted_damage,
          damageAfterArmor: damage_after_armor,
          mitigated
        }
      });
    }
  }

  let after = Math.max(0, before - damage_after_armor);
  if (monster.endureActiveThisTurn) {
    const survive_hp = Math.min(before, minimum_endure_hp(monster));
    if (after < survive_hp) {
      const capped_damage = Math.max(0, before - survive_hp);
      after = survive_hp;
      monster.endureActiveThisTurn = false;

      refresh_active_monster_stats_for_slot(state, slot);
      const speed_before = monster.speed;
      apply_buff_debuff_component(
        state,
        log,
        slot,
        {
          kind: "buff_debuff",
          id: "endure_speed_up",
          target: "self",
          stat: "speed",
          deltaPercent: 50,
          clearsOnSwitch: true
        },
        slot,
        "endure"
      );
      const speed_after = monster.speed;
      monster.endureSpeedBoostActive = true;
      log.push({
        type: "endure_trigger",
        turn: state.turn,
        phase,
        summary: `${monster.name} endured the hit (${before} -> ${after})`,
        data: {
          slot,
          target: monster.id,
          before,
          after,
          attemptedDamage: adjusted_attempted_damage,
          postArmorDamage: damage_after_armor,
          appliedDamage: capped_damage
        }
      });
      log.push({
        type: "stat_mod",
        turn: state.turn,
        phase,
        summary: `${monster.name} gained speed from Endure (${speed_before} -> ${speed_after})`,
        data: { slot, target: monster.id, stat: "speed", multiplier: 1.5, before: speed_before, after: speed_after }
      });
      log.push({
        type: "move_detail",
        turn: state.turn,
        phase,
        summary: `Endure: immortal trigger (HP floor 1% => ${after}); dmg capped ${adjusted_attempted_damage} -> ${capped_damage}; DEX x1.5 (${speed_before} -> ${speed_after})`,
        data: {
          move: "endure",
          slot,
          target: monster.id,
          hpBefore: before,
          hpAfter: after,
          damageAttempted: adjusted_attempted_damage,
          damageAfterArmor: damage_after_armor,
          damageApplied: capped_damage,
          speedBefore: speed_before,
          speedAfter: speed_after
        }
      });
    }
  }

  const final_after = sync_player_shared_hp(state, slot, after);
  const applied = before - final_after;
  if (applied > 0) {
    hp_changed.add(monster);
    took_damage_this_turn[slot] = true;
    if (damage_taken_this_turn) {
      const current = normalize_int(damage_taken_this_turn[slot], 0, 0);
      damage_taken_this_turn[slot] = current + applied;
    }
  }
  return { before, after: final_after, applied };
}

function apply_damage_move(
  state: GameState,
  log: EventLog[],
  player_slot: PlayerSlot,
  spec: ReturnType<typeof move_spec>,
  hp_changed: WeakSet<MonsterState>,
  phase_id: string,
  took_damage_this_turn: Record<PlayerSlot, boolean>,
  damage_taken_this_turn: Record<PlayerSlot, number>,
  incoming_damage_multiplier_percent: Record<PlayerSlot, number>
): void {
  const player = state.players[player_slot];
  const opponent_slot = other_slot(player_slot);
  const opponent = state.players[opponent_slot];
  const attacker = active_monster(player);
  const defender = active_monster(opponent);

  if (!is_alive(attacker)) {
    log.push({
      type: "action_skipped",
      turn: state.turn,
      phase: phase_id,
      summary: `${player_slot} action skipped (fainted)`,
      data: { slot: player_slot, move: spec.id }
    });
    return;
  }
  if (!is_alive(defender)) {
    log.push({
      type: "no_target",
      turn: state.turn,
      phase: phase_id,
      summary: `${player_slot} has no target`,
      data: { slot: player_slot, move: spec.id }
    });
    return;
  }

  const effective_attack = effective_attack_for_slot(state, player_slot, attacker);
  const formula_level = scaled_level_for_formula(attacker.level);
  const multiplier100 = spec.attackMultiplier100 + (spec.attackMultiplierPerLevel100 ?? 0) * formula_level;
  const damage_type = spec.damageType ?? "scaled";
  const effective_defense_base = effective_defense_for_slot(state, opponent_slot, defender);
  const effective_defense = effective_defense_base <= 0 ? 1 : effective_defense_base;
  const level_term = mul_div_floor(1, formula_level, 1) + 30;
  let raw_damage = 0;
  if (spec.id === "ki_blast") {
    raw_damage = Math.max(0, mul_div_floor(effective_attack, 75, 100));
  } else if (spec.id === "throw") {
    const scaled_by_defense = mul_div_floor(level_term * THROW_FIXED_OFFENSE_TERM, 1, effective_defense);
    raw_damage = mul_div_floor(scaled_by_defense, 1, 50) + 2;
  } else if (damage_type === "flat") {
    raw_damage = spec.flatDamage ?? 0;
  } else {
    if (multiplier100 > 0 && effective_attack > 0) {
      const offense_term = level_term * multiplier100 * effective_attack;
      if (damage_type === "true") {
        raw_damage = mul_div_floor(offense_term, 1, 50) + 2;
      } else {
        const scaled_by_defense = mul_div_floor(offense_term, 1, effective_defense);
        raw_damage = mul_div_floor(scaled_by_defense, 1, 50) + 2;
      }
    }
  }
  let damage = Math.max(0, raw_damage);
  const was_blocked =
    defender.protectActiveThisTurn ||
    (defender.specialProtectActiveThisTurn && is_attack_damage_phase(phase_id));
  if (was_blocked) {
    damage = 0;
    log.push({
      type: "damage_blocked",
      turn: state.turn,
      phase: phase_id,
      summary: `${defender.name} blocked the attack`,
      data: { slot: opponent_slot }
    });
  }

  const defender_result = apply_damage_with_endure(
    state,
    log,
    phase_id,
    opponent_slot,
    defender,
    damage,
    hp_changed,
    took_damage_this_turn,
    { source: spec.id, ignoreArmor: spec.id === "seismic_toss" || spec.id === "ki_blast" },
    damage_taken_this_turn,
    incoming_damage_multiplier_percent
  );
  const final_damage = defender_result.applied;

  log.push({
    type: "damage",
    turn: state.turn,
    phase: phase_id,
    summary: `${player_slot} dealt ${final_damage} to ${defender.name}`,
    data: {
      slot: player_slot,
      damage: final_damage,
      target: defender.id,
      before: defender_result.before,
      after: defender_result.after
    }
  });

  const recoil_num = spec.recoilNumerator ?? 0;
  const recoil_den = spec.recoilDenominator ?? 1;
  let recoil_damage = 0;
  let recoil_before = attacker.hp;
  if (recoil_num > 0 && recoil_den > 0 && final_damage > 0) {
    const recoil_attempt = Math.max(0, mul_div_round(final_damage, recoil_num, recoil_den));
    recoil_damage = recoil_attempt;
    if (recoil_damage > 0) {
      const recoil_result = apply_damage_with_endure(
        state,
        log,
        phase_id,
        player_slot,
        attacker,
        recoil_damage,
        hp_changed,
        took_damage_this_turn,
        { ignoreArmor: true, source: "recoil" },
        damage_taken_this_turn,
        incoming_damage_multiplier_percent
      );
      recoil_before = recoil_result.before;
      recoil_damage = recoil_result.applied;
      log.push({
        type: "recoil",
        turn: state.turn,
        phase: phase_id,
        summary: `${attacker.name} took ${recoil_damage} recoil`,
        data: {
          slot: player_slot,
          damage: recoil_damage,
          target: attacker.id,
          before: recoil_result.before,
          after: recoil_result.after
        }
      });
    }
  }

  if (spec.id === "return") {
    const detail = `Return: dmg = floor(((((2*L)/5)+2)*P*A/D)/50)+2 = floor(((${level_term}*${multiplier100}*${effective_attack}/${effective_defense})/50))+2 = ${raw_damage}; final=${final_damage}${
      was_blocked ? " (blocked by Protect)" : ""
    }`;
    log.push({
      type: "move_detail",
      turn: state.turn,
      phase: phase_id,
      summary: detail,
      data: { move: spec.id, damage: final_damage, blocked: was_blocked }
    });
  } else if (spec.id === "double_edge") {
    const detail = `Double-Edge: dmg = floor(((((2*L)/5)+2)*P*A/D)/50)+2 = floor(((${level_term}*120*${effective_attack}/${effective_defense})/50))+2 = ${raw_damage}; final=${final_damage}${
      was_blocked ? " (blocked by Protect)" : ""
    }; recoil = round(final/3) = ${recoil_damage} (${recoil_before} -> ${attacker.hp})`;
    log.push({
      type: "move_detail",
      turn: state.turn,
      phase: phase_id,
      summary: detail,
      data: { move: spec.id, damage: final_damage, recoil: recoil_damage, blocked: was_blocked }
    });
  } else if (spec.id === "seismic_toss") {
    const detail = `Seismic Toss: dmg = flat ${spec.flatDamage ?? 0} (ignores defense); final=${final_damage}${
      was_blocked ? " (blocked by Protect)" : ""
    }`;
    log.push({
      type: "move_detail",
      turn: state.turn,
      phase: phase_id,
      summary: detail,
      data: { move: spec.id, damage: final_damage, blocked: was_blocked }
    });
  } else if (spec.id === "punch") {
    const detail = `Punch: dmg = floor(((((2*L)/5)+2)*93*A/D)/50)+2 = floor(((${level_term}*93*${effective_attack}/${effective_defense})/50))+2 = ${raw_damage}; final=${final_damage}${
      was_blocked ? " (blocked by Protect)" : ""
    }`;
    log.push({
      type: "move_detail",
      turn: state.turn,
      phase: phase_id,
      summary: detail,
      data: { move: spec.id, damage: final_damage, blocked: was_blocked }
    });
  } else if (spec.id === "ki_blast") {
    const detail = `Ki Blast: true dmg = floor(75% STR) = floor(0.75*${effective_attack}) = ${raw_damage}; final=${final_damage}${
      was_blocked ? " (blocked by Protect)" : ""
    }`;
    log.push({
      type: "move_detail",
      turn: state.turn,
      phase: phase_id,
      summary: detail,
      data: { move: spec.id, damage: final_damage, blocked: was_blocked }
    });
  } else if (spec.id === "throw") {
    const detail = `Throw: dmg = floor(((((2*L)/5)+2)*(90*90)/D)/50)+2 = floor(((${level_term}*8100/${effective_defense})/50))+2 = ${raw_damage}; final=${final_damage}${
      was_blocked ? " (blocked by Protect)" : ""
    }`;
    log.push({
      type: "move_detail",
      turn: state.turn,
      phase: phase_id,
      summary: detail,
      data: { move: spec.id, damage: final_damage, blocked: was_blocked }
    });
  } else if (spec.id === "quick_attack") {
    const detail = `Quick Attack: dmg = floor(((((2*L)/5)+2)*P*A/D)/50)+2 = floor(((${level_term}*66*${effective_attack}/${effective_defense})/50))+2 = ${raw_damage}; final=${final_damage}${
      was_blocked ? " (blocked by Protect)" : ""
    }; speed check ignored`;
    log.push({
      type: "move_detail",
      turn: state.turn,
      phase: phase_id,
      summary: detail,
      data: { move: spec.id, damage: final_damage, blocked: was_blocked }
    });
  } else if (spec.id === "focus_punch") {
    const detail = `Focus Punch: dmg = floor(((((2*L)/5)+2)*P*A/D)/50)+2 = floor(((${level_term}*150*${effective_attack}/${effective_defense})/50))+2 = ${raw_damage}; final=${final_damage}${
      was_blocked ? " (blocked by Protect)" : ""
    }`;
    log.push({
      type: "move_detail",
      turn: state.turn,
      phase: phase_id,
      summary: detail,
      data: { move: spec.id, damage: final_damage, blocked: was_blocked }
    });
  }

}

function apply_run_action(
  state: GameState,
  log: EventLog[],
  player_slot: PlayerSlot,
  blocked_by_hook_this_turn: boolean = false
): void {
  ensure_state_runtime_defaults(state);
  const player = state.players[player_slot];
  const actor = active_monster(player);
  if (!is_alive(actor)) {
    log.push({
      type: "action_skipped",
      turn: state.turn,
      phase: "run",
      summary: `${player_slot} run skipped (fainted)`,
      data: { slot: player_slot, action: "run" }
    });
    return;
  }
  reset_fervor_chain(state, player_slot);
  if (blocked_by_hook_this_turn) {
    const before_mSPE = Math.max(0, player.sharedMSPE);
    const reduction = before_mSPE > 0
      ? Math.max(1, mul_div_floor(before_mSPE, HOOK_RUN_MSPE_REDUCTION_PERCENT, 100))
      : 0;
    const after_mSPE = sync_player_shared_mSPE(state, player_slot, before_mSPE - reduction);
    log.push({
      type: "stat_mod",
      turn: state.turn,
      phase: "run",
      summary: `${player_slot} mSPE reduced by Hook (${before_mSPE} -> ${after_mSPE})`,
      data: {
        slot: player_slot,
        target: actor.id,
        stat: "mSPE",
        amountPercent: -HOOK_RUN_MSPE_REDUCTION_PERCENT,
        amount: reduction,
        before: before_mSPE,
        after: after_mSPE
      }
    });
    log.push({
      type: "action_skipped",
      turn: state.turn,
      phase: "run",
      summary: `${player_slot} run failed (Hook)`,
      data: { slot: player_slot, action: "run", reason: "hook", mSPEBefore: before_mSPE, mSPEAfter: after_mSPE }
    });
    log.push({
      type: "move_detail",
      turn: state.turn,
      phase: "run",
      summary: `Hook penalty on Run attempt: -${HOOK_RUN_MSPE_REDUCTION_PERCENT}% mSPE (${before_mSPE} -> ${after_mSPE})`,
      data: {
        action: "run",
        slot: player_slot,
        target: actor.id,
        reason: "hook",
        amountPercent: -HOOK_RUN_MSPE_REDUCTION_PERCENT,
        amount: reduction,
        before: before_mSPE,
        after: after_mSPE
      }
    });
    return;
  }
  const before_mSPE = Math.max(0, player.sharedMSPE);
  const gain = Math.max(1, mul_div_round(before_mSPE, RUN_MSPE_GAIN_PERCENT, 100));
  const after_mSPE = sync_player_shared_mSPE(state, player_slot, before_mSPE + gain);
  log.push({
    type: "stat_mod",
    turn: state.turn,
    phase: "run",
    summary: `${player_slot} used Run (+${RUN_MSPE_GAIN_PERCENT}% M.SPE: ${before_mSPE} -> ${after_mSPE})`,
    data: {
      slot: player_slot,
      target: actor.id,
      stat: "mSPE",
      amountPercent: RUN_MSPE_GAIN_PERCENT,
      amount: gain,
      before: before_mSPE,
      after: after_mSPE
    }
  });
  log.push({
    type: "move_detail",
    turn: state.turn,
    phase: "run",
    summary: `Run(+${RUN_MSPE_GAIN_PERCENT}% M.SPE): +${gain} (${before_mSPE} -> ${after_mSPE})`,
    data: {
      action: "run",
      slot: player_slot,
      target: actor.id,
      amountPercent: RUN_MSPE_GAIN_PERCENT,
      amount: gain,
      before: before_mSPE,
      after: after_mSPE
    }
  });
}

function apply_move(
  state: GameState,
  log: EventLog[],
  player_slot: PlayerSlot,
  move_id: MoveId,
  move_index: number,
  hp_changed: WeakSet<MonsterState>,
  focus_punch_pending: Record<PlayerSlot, boolean>,
  took_damage_this_turn: Record<PlayerSlot, boolean>,
  damage_taken_this_turn: Record<PlayerSlot, number>,
  rejuvenation_used_this_turn: Record<PlayerSlot, boolean>,
  hook_run_blocked_this_turn: Record<PlayerSlot, boolean>,
  incoming_damage_multiplier_percent: Record<PlayerSlot, number>,
  pending_happiness_apply_by_slot: Record<PlayerSlot, boolean>
): void {
  const player = state.players[player_slot];
  const opponent = state.players[other_slot(player_slot)];
  const attacker = active_monster(player);
  const defender = active_monster(opponent);

  if (!is_alive(attacker)) {
    log.push({
      type: "action_skipped",
      turn: state.turn,
      summary: `${player_slot} action skipped (fainted)`,
      data: { slot: player_slot }
    });
    return;
  }

  const spec = move_spec(move_id);
  const components = spec.components ?? spec.collateral ?? [];
  const effect_collaterals = components.filter(
    (entry): entry is EffectCollateral => entry.kind === "effect"
  );
  const curse_collaterals = components.filter(
    (entry): entry is CurseCollateral => entry.kind === "curse"
  );
  const buff_debuff_collaterals = components.filter(
    (entry): entry is BuffDebuffCollateral => entry.kind === "buff_debuff"
  );
  const instant_collaterals = components.filter(
    (entry): entry is InstantCollateral => entry.kind === "instant"
  );
  const finalize_move_success = (): void => {
    update_fervor_chain_after_move_success(state, player_slot, move_id);
    mark_last_move_used(state, player_slot, move_id, move_index);
    apply_move_effects_from_collateral(state, log, player_slot, effect_collaterals, spec.id, spec.phaseId);
    apply_move_curses_from_collateral(state, log, player_slot, curse_collaterals, spec.id, spec.phaseId);
    apply_move_buff_debuffs_from_collateral(state, log, player_slot, buff_debuff_collaterals, spec.id, spec.phaseId);
    apply_move_instants_from_collateral(state, log, player_slot, instant_collaterals, spec.id, spec.phaseId);
  };

  const blocked_by = move_block_reason(state, player_slot, move_index, spec);
  if (blocked_by) {
    const type = blocked_by === "taunt" ? "taunt_blocked" : "effect_blocked";
    const turns_remaining = blocked_by === "happiness"
      ? curse_turns_remaining(state, player_slot, "happiness")
      : blocked_by === "frustration"
        ? curse_turns_remaining(state, player_slot, "frustration")
      : EFFECT_ID_SET.has(blocked_by)
        ? effect_turns_remaining(state, player_slot, blocked_by as EffectCollateralId)
        : 0;
    log.push({
      type,
      turn: state.turn,
      phase: spec.phaseId,
      summary: move_block_summary(player_slot, blocked_by, spec.label),
      data: {
        slot: player_slot,
        move: spec.id,
        reason: blocked_by,
        turnsRemaining: turns_remaining
      }
    });
    return;
  }

  if (spec.id === "none") {
    finalize_move_success();
    log.push({
      type: "move_none",
      turn: state.turn,
      phase: spec.phaseId,
      summary: `${player_slot} waits`,
      data: { slot: player_slot, moveIndex: move_index }
    });
    return;
  }

  if (spec.id === "protect") {
    const guard_cooldown = Math.max(attacker.protectCooldownTurns, attacker.endureCooldownTurns);
    if (guard_cooldown > 0) {
      log.push({
        type: "protect_blocked",
        turn: state.turn,
        phase: spec.phaseId,
        summary: `${player_slot} tried Protect but is on cooldown`,
        data: { slot: player_slot }
      });
      return;
    }
    attacker.protectActiveThisTurn = true;
    attacker.protectCooldownTurns = 2;
    attacker.endureCooldownTurns = 2;
    log.push({
      type: "protect",
      turn: state.turn,
      phase: spec.phaseId,
      summary: `${player_slot} used Protect`,
      data: { slot: player_slot }
    });
    finalize_move_success();
    return;
  }

  if (spec.id === "special_protect") {
    const special_protect_cooldown = Math.max(0, normalize_int(attacker.specialProtectCooldownTurns, 0, 0));
    if (special_protect_cooldown > 0) {
      log.push({
        type: "special_protect_blocked",
        turn: state.turn,
        phase: spec.phaseId,
        summary: `${player_slot} tried Special Protect but is on cooldown`,
        data: { slot: player_slot, reason: "cooldown" }
      });
      return;
    }
    attacker.specialProtectActiveThisTurn = true;
    attacker.specialProtectCooldownTurns = 2;
    upsert_curse(state, log, player_slot, "frustration", player_slot, spec.id, { remainingTurns: 1 });
    log.push({
      type: "special_protect",
      turn: state.turn,
      phase: spec.phaseId,
      summary: `${player_slot} used Special Protect (Immune + Frustration 1 turn)`,
      data: { slot: player_slot, target: attacker.id, cooldownTurns: 1, drawback: "frustration" }
    });
    finalize_move_success();
    return;
  }

  if (spec.id === "endure") {
    const guard_cooldown = Math.max(attacker.protectCooldownTurns, attacker.endureCooldownTurns);
    if (guard_cooldown > 0) {
      log.push({
        type: "endure_blocked",
        turn: state.turn,
        phase: spec.phaseId,
        summary: `${player_slot} tried Endure but is on cooldown`,
        data: { slot: player_slot }
      });
      return;
    }
    const floor_hp = minimum_endure_hp(attacker);
    attacker.endureActiveThisTurn = true;
    attacker.protectCooldownTurns = 2;
    attacker.endureCooldownTurns = 2;
    log.push({
      type: "endure",
      turn: state.turn,
      phase: spec.phaseId,
      summary: `${player_slot} used Endure`,
      data: { slot: player_slot, target: attacker.id }
    });
    log.push({
      type: "move_detail",
      turn: state.turn,
      phase: spec.phaseId,
      summary: `Endure: HP floor this turn = ${floor_hp} (1% do maxHp); on trigger gain DEX x1.5`,
      data: { move: spec.id, slot: player_slot, target: attacker.id, floorHp: floor_hp }
    });
    finalize_move_success();
    return;
  }

  if (spec.id === "bait") {
    const opponent_slot = other_slot(player_slot);
    const took_damage_before_bait = !!took_damage_this_turn[player_slot];
    if (!took_damage_before_bait) {
      log.push({
        type: "bait_failed",
        turn: state.turn,
        phase: spec.phaseId,
        summary: `${player_slot} used Bait but failed (no prior damage this turn)`,
        data: { slot: player_slot, target: attacker.id, move: spec.id, reason: "no_prior_damage" }
      });
      finalize_move_success();
      return;
    }
    if (is_special_protect_blocking_target_effect(state, player_slot, opponent_slot, spec.phaseId)) {
      log_special_protect_block(state, log, player_slot, opponent_slot, spec.id, spec.phaseId, "debuff");
      finalize_move_success();
      return;
    }
    upsert_effect(state, log, opponent_slot, "weakness", 2, player_slot, spec.id);
    log.push({
      type: "bait_trigger",
      turn: state.turn,
      phase: spec.phaseId,
      summary: `${attacker.name} triggered Bait on ${defender.name} (Weakness 2 turns)`,
      data: {
        slot: player_slot,
        targetSlot: opponent_slot,
        source: attacker.id,
        target: defender.id,
        effect: "weakness",
        duration: 2
      }
    });
    log.push({
      type: "move_detail",
      turn: state.turn,
      phase: spec.phaseId,
      summary: "Bait: success after taking damage earlier this turn (applies Weakness for 2 turns)",
      data: { move: spec.id, slot: player_slot, target: defender.id, effect: "weakness", duration: 2 }
    });
    finalize_move_success();
    return;
  }

  if (spec.id === "agility") {
    refresh_active_monster_stats_for_slot(state, player_slot);
    const before_speed = attacker.speed;
    apply_buff_debuff_component(
      state,
      log,
      player_slot,
      {
        kind: "buff_debuff",
        id: "agility_speed_up",
        target: "self",
        stat: "speed",
        deltaPercent: 100,
        clearsOnSwitch: true
      },
      player_slot,
      spec.id
    );
    const after_speed = attacker.speed;
    log.push({
      type: "stat_mod",
      turn: state.turn,
      phase: spec.phaseId,
      summary: `${player_slot} Agility success on ${attacker.name} (DEX ${before_speed} -> ${after_speed})`,
      data: {
        slot: player_slot,
        target: attacker.id,
        stat: "speed",
        multiplier: 2,
        before: before_speed,
        after: after_speed
      }
    });
    log.push({
      type: "move_detail",
      turn: state.turn,
      phase: spec.phaseId,
      summary: `Agility: user DEX x2 (${before_speed} -> ${after_speed})`,
      data: { move: spec.id, slot: player_slot, target: attacker.id, before: before_speed, after: after_speed }
    });
    finalize_move_success();
    return;
  }

  if (spec.id === "power") {
    ensure_state_runtime_defaults(state);
    refresh_active_monster_stats_for_slot(state, player_slot);
    const before_stage = effective_attack_stage_for_monster(state, player_slot, attacker);
    const before_attack = attacker.attack;
    const before_speed = attacker.speed;
    if (before_stage < STAT_STAGE_MAX) {
      state.activeBuffDebuffsBySlot[player_slot].push({
        id: "power_attack_stage_up",
        sourceSlot: player_slot,
        source: spec.id,
        stat: "attack",
        deltaPercent: 0,
        clearsOnSwitch: true,
        targetMonsterId: attacker.id
      });
    }
    apply_buff_debuff_component(
      state,
      log,
      player_slot,
      {
        kind: "buff_debuff",
        id: "power_speed_down",
        target: "self",
        stat: "speed",
        deltaPercent: -10,
        clearsOnSwitch: false
      },
      player_slot,
      spec.id,
      { targetMonsterId: attacker.id }
    );
    refresh_active_monster_stats_for_slot(state, player_slot);
    const after_stage = effective_attack_stage_for_monster(state, player_slot, attacker);
    const after_attack = attacker.attack;
    const after_speed = attacker.speed;
    if (after_stage !== before_stage || after_attack !== before_attack) {
      log.push({
        type: "stat_mod",
        turn: state.turn,
        phase: spec.phaseId,
        summary: `${attacker.name} ATK stage ${before_stage} -> ${after_stage}`,
        data: {
          slot: player_slot,
          target: attacker.id,
          stat: "attack",
          stageBefore: before_stage,
          stageAfter: after_stage,
          before: before_attack,
          after: after_attack
        }
      });
    }
    log.push({
      type: "move_detail",
      turn: state.turn,
      phase: spec.phaseId,
      summary: `Power: ATK stage ${before_stage} -> ${after_stage} (${before_attack} -> ${after_attack}) e DEX -10% do base (${before_speed} -> ${after_speed})`,
      data: {
        move: spec.id,
        slot: player_slot,
        target: attacker.id,
        stageBefore: before_stage,
        stageAfter: after_stage,
        attackBefore: before_attack,
        attackAfter: after_attack,
        speedBefore: before_speed,
        speedAfter: after_speed
      }
    });
    finalize_move_success();
    return;
  }

  if (spec.id === "switch_sovietico") {
    ensure_state_runtime_defaults(state);
    const queued_slots: PlayerSlot[] = [];
    for (const slot_id of SLOT_ORDER) {
      if (
        slot_id === other_slot(player_slot) &&
        is_special_protect_blocking_target_effect(state, player_slot, slot_id, spec.phaseId)
      ) {
        log_special_protect_block(state, log, player_slot, slot_id, spec.id, spec.phaseId, "forced switch");
        state.pendingSwitch[slot_id] = false;
        state.pendingSwitchReason[slot_id] = "none";
        state.pendingSwitchResolvedThisTurn[slot_id] = false;
        continue;
      }
      const switch_player = state.players[slot_id];
      if (first_available_switch_target(switch_player) === null) {
        state.pendingSwitch[slot_id] = false;
        state.pendingSwitchReason[slot_id] = "none";
        state.pendingSwitchResolvedThisTurn[slot_id] = false;
        log.push({
          type: "switch_invalid",
          turn: state.turn,
          phase: spec.phaseId,
          summary: `${slot_id} could not switch (no available target)`,
          data: {
            slot: slot_id,
            move: spec.id,
            reason: "no_available_target"
          }
        });
        continue;
      }
      state.pendingSwitch[slot_id] = true;
      state.pendingSwitchReason[slot_id] = "switch_sovietico";
      state.pendingSwitchResolvedThisTurn[slot_id] = false;
      queued_slots.push(slot_id);
    }

    log.push({
      type: "move_detail",
      turn: state.turn,
      phase: spec.phaseId,
      summary:
        queued_slots.length === 2
          ? "Switch Sovietico armed: both players must choose switch at next turn start"
          : queued_slots.length === 1
            ? `Switch Sovietico armed: ${queued_slots[0]} must choose switch at next turn start`
            : "Switch Sovietico armed: no available switch targets",
      data: {
        move: spec.id,
        pendingSwitchPlayer1: !!state.pendingSwitch.player1,
        pendingSwitchPlayer2: !!state.pendingSwitch.player2
      }
    });
    finalize_move_success();
    return;
  }

  if (spec.id === "team_cure") {
    ensure_state_runtime_defaults(state);
    const effects_before = state.activeEffectsBySlot[player_slot];
    const buff_debuffs_before = state.activeBuffDebuffsBySlot[player_slot].length;
    state.activeEffectsBySlot[player_slot] = effects_before.filter((entry) => !is_negative_stat_effect_id(entry.id));
    const effects_removed = Math.max(0, effects_before.length - state.activeEffectsBySlot[player_slot].length);
    state.activeBuffDebuffsBySlot[player_slot] = state.activeBuffDebuffsBySlot[player_slot].filter(
      (entry) => !(entry.clearsOnSwitch === true && is_negative_stat_buff_debuff(entry))
    );
    const buff_debuffs_removed = Math.max(
      0,
      buff_debuffs_before - state.activeBuffDebuffsBySlot[player_slot].length
    );
    refresh_active_monster_stats_for_slot(state, player_slot);
    log.push({
      type: "move_detail",
      turn: state.turn,
      phase: spec.phaseId,
      summary: `Team Cure: removed ${effects_removed} negative effects and ${buff_debuffs_removed} negative buff/debuffs from team`,
      data: {
        move: spec.id,
        slot: player_slot,
        effectsRemoved: effects_removed,
        buffDebuffsRemoved: buff_debuffs_removed
      }
    });
    finalize_move_success();
    return;
  }

  if (spec.id === "run") {
    apply_run_action(state, log, player_slot, hook_run_blocked_this_turn[player_slot]);
    finalize_move_success();
    return;
  }

  if (spec.id === "hook") {
    const target_slot = other_slot(player_slot);
    const target_player = state.players[target_slot];
    const target = active_monster(target_player);
    const self_player = state.players[player_slot];
    const run_lock_blocked_by_special_protect =
      is_special_protect_blocking_target_effect(state, player_slot, target_slot, spec.phaseId);
    if (run_lock_blocked_by_special_protect) {
      log_special_protect_block(state, log, player_slot, target_slot, spec.id, spec.phaseId, "run lock");
    } else {
      hook_run_blocked_this_turn[target_slot] = true;
    }
    incoming_damage_multiplier_percent[player_slot] = Math.max(
      HOOK_EXPOSURE_INCOMING_DAMAGE_MULTIPLIER_PERCENT,
      normalize_int(incoming_damage_multiplier_percent[player_slot], 100, 0)
    );
    const before_self_mSPE = Math.max(0, normalize_int(self_player.sharedMSPE, SHARED_MSPE_START, 0));
    const self_mSPE_reduction =
      before_self_mSPE > 0
        ? Math.max(1, mul_div_floor(before_self_mSPE, HOOK_SELF_MSPE_REDUCTION_PERCENT, 100))
        : 0;
    const after_self_mSPE = sync_player_shared_mSPE(state, player_slot, before_self_mSPE - self_mSPE_reduction);
    log.push({
      type: "move_detail",
      turn: state.turn,
      phase: spec.phaseId,
      summary:
        `Hook: ${
          run_lock_blocked_by_special_protect ? "run lock blocked by Special Protect" : "blocks enemy Run"
        }; if target attempts Run then mSPE -${HOOK_RUN_MSPE_REDUCTION_PERCENT}% | ` +
        `self gains Exposicao (+66% incoming damage in attack phases) and mSPE -${HOOK_SELF_MSPE_REDUCTION_PERCENT}%`,
      data: {
        move: spec.id,
        slot: player_slot,
        targetSlot: target_slot,
        source: attacker.id,
        target: target.id,
        blocksRunThisTurn: !run_lock_blocked_by_special_protect,
        runMSPEReductionPercentOnAttempt: HOOK_RUN_MSPE_REDUCTION_PERCENT,
        selfIncomingDamagePercentInAttackPhases: incoming_damage_multiplier_percent[player_slot],
        selfMSPEBefore: before_self_mSPE,
        selfMSPEAfter: after_self_mSPE,
        selfMSPEDeltaPercent: -HOOK_SELF_MSPE_REDUCTION_PERCENT
      }
    });
    finalize_move_success();
    return;
  }

  if (spec.id === "rejuvenation") {
    ensure_state_runtime_defaults(state);
    rejuvenation_used_this_turn[player_slot] = true;
    const existing_regen = heal_buff_state(state, player_slot, REJUVENATION_REGEN_HEAL_BUFF_ID);
    const regen_value_per_turn = REJUVENATION_REGEN_FLAT_PER_STACK;
    const starts_next_turn = state.turn + 1;
    const stack_before = existing_regen
      ? Math.min(REJUVENATION_REGEN_STACK_MAX, Math.max(1, normalize_int(state.rejuvenationStacks?.[player_slot] ?? 1, 1, 1)))
      : 0;
    if (!existing_regen) {
      upsert_heal_buff(state, log, player_slot, player_slot, spec.id, {
        id: REJUVENATION_REGEN_HEAL_BUFF_ID,
        source: spec.id,
        healPerTurn: regen_value_per_turn,
        growthPerTurn: 0,
        startTurn: starts_next_turn,
        remainingTicks: null,
        clearsOnSwitch: false
      });
      state.rejuvenationStacks[player_slot] = 1;
      state.rejuvenationStartTurn[player_slot] = starts_next_turn;
    } else {
      if (stack_before < REJUVENATION_REGEN_STACK_MAX) {
        const pending_growth = Math.max(0, normalize_int(existing_regen.growthPerTurn, 0, 0));
        existing_regen.growthPerTurn = Math.min(regen_value_per_turn, pending_growth + regen_value_per_turn);
      } else {
        existing_regen.growthPerTurn = 0;
      }
      state.rejuvenationStacks[player_slot] = Math.min(
        REJUVENATION_REGEN_STACK_MAX,
        stack_before + (stack_before < REJUVENATION_REGEN_STACK_MAX ? 1 : 0)
      );
      if ((state.rejuvenationStartTurn?.[player_slot] ?? 0) <= 0) {
        state.rejuvenationStartTurn[player_slot] = starts_next_turn;
      }
    }
    upsert_effect(state, log, player_slot, "rejuvenation", 999, player_slot, spec.id);
    log.push({
      type: "move_detail",
      turn: state.turn,
      phase: spec.phaseId,
      summary:
        stack_before <= 0
          ? `Rejuvenation: cura 50% do dano sofrido neste turno; regen ativo a partir do turno ${starts_next_turn} (+${REJUVENATION_REGEN_FLAT_PER_STACK} por turno)`
          : stack_before >= REJUVENATION_REGEN_STACK_MAX
            ? `Rejuvenation: cura 50% do dano sofrido neste turno; regen ja esta no maximo (+${REJUVENATION_REGEN_FLAT_MAX} por turno)`
            : `Rejuvenation: cura 50% do dano sofrido neste turno; regen +${REJUVENATION_REGEN_FLAT_PER_STACK} no proximo turno`,
      data: {
        move: spec.id,
        slot: player_slot,
        target: attacker.id,
        reactiveHealPercentOfDamageTaken: 50,
        regenStartTurn: state.rejuvenationStartTurn[player_slot],
        regenStackBefore: stack_before,
        regenStackAfter: state.rejuvenationStacks[player_slot],
        regenValuePerTurn: regen_value_per_turn
      }
    });
    finalize_move_success();
    return;
  }

  if (spec.id === "wish") {
    const trigger_turn = state.turn + 1;
    if (!state.pendingWish) {
      state.pendingWish = empty_pending_wish();
    }
    state.pendingWish[player_slot] = trigger_turn;
    log.push({
      type: "move_detail",
      turn: state.turn,
      phase: spec.phaseId,
      summary: `Wish: no turno ${trigger_turn}, no inicio do ending_turn, o ativo de ${player_slot} cura +50% do maxHp (clamp no max)`,
      data: { move: spec.id, slot: player_slot, triggerTurn: trigger_turn }
    });
    finalize_move_success();
    return;
  }

  if (spec.id === "spikes") {
    const target_slot = other_slot(player_slot);
    if (is_special_protect_blocking_target_effect(state, player_slot, target_slot, spec.phaseId)) {
      log_special_protect_block(state, log, player_slot, target_slot, spec.id, spec.phaseId, "hazard");
      finalize_move_success();
      return;
    }
    state.spikesArmedByTarget[target_slot] = true;
    log.push({
      type: "spikes_set",
      turn: state.turn,
      phase: spec.phaseId,
      summary: `${player_slot} armed Spikes on ${target_slot}`,
      data: { slot: player_slot, targetSlot: target_slot, target: defender.id }
    });
    finalize_move_success();
    return;
  }

  if (spec.id === "recover") {
    const heal_per_turn = Math.max(0, mul_div_round(player.sharedHpMax, 1, 5));
    const recover_buff: ActiveHealBuffState = {
      id: RECOVER_MOVE_HEAL_BUFF_ID,
      sourceSlot: player_slot,
      source: spec.id,
      healPerTurn: heal_per_turn,
      growthPerTurn: 0,
      startTurn: state.turn,
      remainingTicks: 1,
      clearsOnSwitch: false
    };
    apply_heal_buff_tick(state, log, player_slot, hp_changed, recover_buff, spec.phaseId);
    finalize_move_success();
    return;
  }

  if (spec.id === "heal") {
    const heal_per_turn = Math.max(0, mul_div_round(player.sharedHpMax, 1, 5));
    const heal_buff: ActiveHealBuffState = {
      id: HEAL_MOVE_HEAL_BUFF_ID,
      sourceSlot: player_slot,
      source: spec.id,
      healPerTurn: heal_per_turn,
      growthPerTurn: 0,
      startTurn: state.turn,
      remainingTicks: 1,
      clearsOnSwitch: false
    };
    apply_heal_buff_tick(state, log, player_slot, hp_changed, heal_buff, spec.phaseId);
    finalize_move_success();
    return;
  }

  if (spec.id === "meditate") {
    ensure_state_runtime_defaults(state);
    state.activeBuffDebuffsBySlot[player_slot] = state.activeBuffDebuffsBySlot[player_slot].filter(
      (entry) => !(entry.id === "meditate_attack_up" && entry.stat === "attack")
    );
    refresh_active_monster_stats_for_slot(state, player_slot);
    const before_stage = attacker.attackStage;
    const before_attack = attacker.attack;
    attacker.attackStage = clamp_stat_stage(before_stage + MEDITATE_ATTACK_STAGE_PER_CAST);
    refresh_active_monster_stats_for_slot(state, player_slot);
    const after_stage = attacker.attackStage;
    const after_attack = attacker.attack;
    const ratio = stage_ratio(after_stage);
    log.push({
      type: "stat_mod",
      turn: state.turn,
      phase: spec.phaseId,
      summary: `${player_slot} used Meditate on ${attacker.name} (ATK ${before_attack} -> ${after_attack}, stage ${before_stage} -> ${after_stage})`,
      data: {
        slot: player_slot,
        target: attacker.id,
        stat: "attack",
        stageBefore: before_stage,
        stageAfter: after_stage,
        multiplierNumerator: ratio.numerator,
        multiplierDenominator: ratio.denominator,
        before: before_attack,
        after: after_attack
      }
    });
    log.push({
      type: "move_detail",
      turn: state.turn,
      phase: spec.phaseId,
      summary: `Meditate: ATK stage ${before_stage} -> ${after_stage} (x${ratio.numerator}/${ratio.denominator})`,
      data: {
        move: spec.id,
        slot: player_slot,
        target: attacker.id,
        stageBefore: before_stage,
        stageAfter: after_stage,
        attackBefore: before_attack,
        attackAfter: after_attack
      }
    });
    finalize_move_success();
    return;
  }

  if (spec.id === "belly_drum") {
    refresh_active_monster_stats_for_slot(state, player_slot);
    const before_hp = player.sharedHp;
    if (before_hp * 2 <= attacker.maxHp) {
      log.push({
        type: "belly_drum_failed",
        turn: state.turn,
        phase: spec.phaseId,
        summary: `${player_slot} used Belly Drum but failed (${attacker.name} HP ${before_hp}/${attacker.maxHp})`,
        data: { slot: player_slot, target: attacker.id, move: spec.id, hp: before_hp, maxHp: attacker.maxHp, reason: "hp_not_above_half" }
      });
      return;
    }

    const before_stage = attacker.attackStage;
    const before_attack = attacker.attack;
    const hp_cost = mul_div_floor(before_hp, 1, 2);
    const after_hp = Math.max(0, before_hp - hp_cost);
    sync_player_shared_hp(state, player_slot, after_hp);
    clear_buff_debuffs_for_stat(state, player_slot, "attack");
    attacker.attackStage = STAT_STAGE_MAX;
    refresh_active_monster_stats_for_slot(state, player_slot);
    const after_stage = attacker.attackStage;
    const after_attack = attacker.attack;

    const hp_spent = Math.max(0, before_hp - after_hp);
    if (hp_spent > 0) {
      hp_changed.add(attacker);
      log.push({
        type: "recoil",
        turn: state.turn,
        phase: spec.phaseId,
        summary: `${attacker.name} paid ${hp_spent} HP for Belly Drum`,
        data: { slot: player_slot, damage: hp_spent, target: attacker.id, move: spec.id }
      });
    }

    log.push({
      type: "stat_mod",
      turn: state.turn,
      phase: spec.phaseId,
      summary: `${player_slot} used Belly Drum on ${attacker.name} (ATK ${before_attack} -> ${after_attack})`,
      data: {
        slot: player_slot,
        target: attacker.id,
        stat: "attack",
        stageBefore: before_stage,
        stageAfter: after_stage,
        before: before_attack,
        after: after_attack
      }
    });
    log.push({
      type: "move_detail",
      turn: state.turn,
      phase: spec.phaseId,
      summary: `Belly Drum: user paga floor(HP atual/2) (${before_hp} -> ${after_hp}); ATK stage ${before_stage} -> ${after_stage} (${before_attack} -> ${after_attack})`,
      data: {
        move: spec.id,
        slot: player_slot,
        target: attacker.id,
        hpBefore: before_hp,
        hpAfter: after_hp,
        hpCost: hp_cost,
        hpCostBasedOn: "currentHp",
        stageBefore: before_stage,
        stageAfter: after_stage,
        attackBefore: before_attack,
        attackAfter: after_attack
      }
    });
    finalize_move_success();
    return;
  }

  if (!is_alive(defender)) {
    log.push({
      type: "no_target",
      turn: state.turn,
      phase: spec.phaseId,
      summary: `${player_slot} has no target`,
      data: { slot: player_slot }
    });
    return;
  }

  if (spec.id === "fervor") {
    ensure_state_runtime_defaults(state);
    const chain_before = normalize_fervor_chain(state.fervorChainBySlot[player_slot]);
    const cast_streak = fervor_cast_streak_from_chain(chain_before);
    const multiplier100 = fervor_multiplier100_for_chain(chain_before);
    const fervor_spec: ReturnType<typeof move_spec> = {
      ...spec,
      attackMultiplier100: multiplier100,
      attackMultiplierPerLevel100: 0
    };
    apply_damage_move(
      state,
      log,
      player_slot,
      fervor_spec,
      hp_changed,
      spec.phaseId,
      took_damage_this_turn,
      damage_taken_this_turn,
      incoming_damage_multiplier_percent
    );
    finalize_move_success();
    pending_happiness_apply_by_slot[player_slot] = true;
    const chain_after = normalize_fervor_chain(state.fervorChainBySlot[player_slot]);
    const next_multiplier100 = fervor_multiplier100_for_chain(chain_after);
    log.push({
      type: "move_detail",
      turn: state.turn,
      phase: spec.phaseId,
      summary:
        `Fervor: cast ${cast_streak} -> multiplier ${multiplier100}; ` +
        `next cast ${Math.min(3, chain_after + 1)} -> ${next_multiplier100}; ` +
        "Happiness queued for ending_turn",
      data: {
        move: spec.id,
        slot: player_slot,
        target: defender.id,
        castStreak: cast_streak,
        multiplier100,
        nextCastStreak: Math.min(3, chain_after + 1),
        nextMultiplier100: next_multiplier100
      }
    });
    return;
  }

  if (spec.id === "leech_life") {
    const target_slot = other_slot(player_slot);
    log.push({
      type: "move_detail",
      turn: state.turn,
      phase: spec.phaseId,
      summary: "Leech Seed (curse): drains at ending_turn and ends when the target switches",
      data: { move: spec.id, slot: player_slot, target: defender.id, targetSlot: target_slot }
    });
    finalize_move_success();
    return;
  }

  if (spec.id === "sekyps") {
    const target_slot = other_slot(player_slot);
    const existing_stack = Math.max(0, curse_stacks(state, target_slot, "sekyps"));
    const after_stack = Math.max(1, existing_stack + 1);
    log.push({
      type: "move_detail",
      turn: state.turn,
      phase: spec.phaseId,
      summary:
        "Sekyps (curse): no ending_turn causa dano flat por stack (24/48/72/...), stacka ao reaplicar, nao remove no switch, cada stack novo so entra no dano no turno seguinte e nao causa dano no turno em que o alvo troca",
      data: {
        move: spec.id,
        slot: player_slot,
        target: defender.id,
        targetSlot: target_slot,
        baseDamage: SEKYPS_DAMAGE_PER_STACK,
        stackAfterApply: after_stack
      }
    });
    finalize_move_success();
    return;
  }

  if (spec.id === "mirror") {
    const target_slot = other_slot(player_slot);
    refresh_active_monster_stats_for_slot(state, target_slot);
    const source_stage = effective_attack_stage_for_monster(state, player_slot, attacker);
    const target_stage_before = effective_attack_stage_for_monster(state, target_slot, defender);
    const target_attack_before = defender.attack;
    finalize_move_success();
    refresh_active_monster_stats_for_slot(state, target_slot);
    const target_stage_after = effective_attack_stage_for_monster(state, target_slot, defender);
    const target_attack_after = defender.attack;
    log.push({
      type: "move_detail",
      turn: state.turn,
      phase: spec.phaseId,
      summary:
        `Mirror: target ATK stage mirrors caster (${target_stage_before} -> ${target_stage_after}; ` +
        `source stage ${source_stage}, ${target_attack_before} -> ${target_attack_after})`,
      data: {
        move: spec.id,
        slot: player_slot,
        target: defender.id,
        targetSlot: target_slot,
        sourceStage: source_stage,
        targetStageBefore: target_stage_before,
        targetStageAfter: target_stage_after,
        targetAttackBefore: target_attack_before,
        targetAttackAfter: target_attack_after
      }
    });
    return;
  }

  if (spec.id === "focus_punch") {
    focus_punch_pending[player_slot] = true;
    log.push({
      type: "focus_punch_charge",
      turn: state.turn,
      phase: spec.phaseId,
      summary: `${player_slot} is tightening focus for Focus Punch`,
      data: { slot: player_slot, target: defender.id }
    });
    log.push({
      type: "move_detail",
      turn: state.turn,
      phase: spec.phaseId,
      summary: "Focus Punch: resolves at start of ending_turn; fails if user took real damage before executing",
      data: { move: spec.id, slot: player_slot, target: defender.id }
    });
    finalize_move_success();
    return;
  }

  if (spec.id === "screech") {
    const defender_slot = other_slot(player_slot);
    if (is_special_protect_blocking_target_effect(state, player_slot, defender_slot, spec.phaseId)) {
      log_special_protect_block(state, log, player_slot, defender_slot, spec.id, spec.phaseId, "defense debuff");
      finalize_move_success();
      return;
    }
    if (is_slot_clear_body_active(state, defender_slot)) {
      const armor_stack = type_passive_armor_stack(state, defender_slot);
      log.push({
        type: "clear_body_blocked",
        turn: state.turn,
        phase: spec.phaseId,
        summary: `${defender.name} blocked Screech with Clear Body [Instant]`,
        data: {
          slot: defender_slot,
          target: defender.id,
          sourceSlot: player_slot,
          source: attacker.id,
          move: spec.id,
          armorStack: armor_stack
        }
      });
      log.push({
        type: "move_detail",
        turn: state.turn,
        phase: spec.phaseId,
        summary: `Screech blocked by Clear Body [Instant] (armor stack ${armor_stack})`,
        data: { move: spec.id, target: defender.id, blockedBy: "clear_body", armorStack: armor_stack }
      });
      finalize_move_success();
      return;
    }
    refresh_active_monster_stats_for_slot(state, defender_slot);
    const before_defense = defender.defense;
    apply_buff_debuff_component(
      state,
      log,
      defender_slot,
      {
        kind: "buff_debuff",
        id: "screech_def_down",
        target: "opponent",
        stat: "defense",
        deltaPercent: -50,
        clearsOnSwitch: true
      },
      player_slot,
      spec.id
    );
    const after_defense = defender.defense;
    log.push({
      type: "stat_mod",
      turn: state.turn,
      phase: spec.phaseId,
      summary: `${player_slot} used Screech on ${defender.name} (DEF ${before_defense} -> ${after_defense})`,
      data: {
        slot: player_slot,
        target: defender.id,
        stat: "defense",
        multiplier: 0.5,
        before: before_defense,
        after: after_defense
      }
    });
    log.push({
      type: "move_detail",
      turn: state.turn,
      phase: spec.phaseId,
      summary: `Screech: target DEF x0.5 (${before_defense} -> ${after_defense})`,
      data: { move: spec.id, target: defender.id, before: before_defense, after: after_defense }
    });
    finalize_move_success();
    return;
  }

  if (spec.id === "taunt") {
    const taunt_duration = effect_collaterals.find((entry) => entry.id === "taunt")?.maxDurationTurns ?? 0;
    log.push({
      type: "move_detail",
      turn: state.turn,
      phase: spec.phaseId,
      summary: `Taunt: target forced to attack moves for ${Math.max(1, taunt_duration)} turn(s)`,
      data: {
        move: spec.id,
        slot: player_slot,
        target: defender.id,
        targetSlot: other_slot(player_slot),
        duration: Math.max(1, taunt_duration)
      }
    });
    finalize_move_success();
    return;
  }

  if (spec.id === "pain_split") {
    const target_slot = other_slot(player_slot);
    if (is_special_protect_blocking_target_effect(state, player_slot, target_slot, spec.phaseId)) {
      log_special_protect_block(state, log, player_slot, target_slot, spec.id, spec.phaseId, "hp split");
      finalize_move_success();
      return;
    }
    const before_user_hp = player.sharedHp;
    const before_target_hp = opponent.sharedHp;
    const shared_hp = Math.max(1, mul_div_floor(before_user_hp + before_target_hp, 1, 2));
    const after_user_hp = Math.min(attacker.maxHp, shared_hp);
    const after_target_hp = Math.min(defender.maxHp, shared_hp);

    sync_player_shared_hp(state, player_slot, after_user_hp);
    sync_player_shared_hp(state, other_slot(player_slot), after_target_hp);
    if (after_user_hp !== before_user_hp) {
      hp_changed.add(attacker);
    }
    if (after_target_hp !== before_target_hp) {
      hp_changed.add(defender);
    }

    log.push({
      type: "pain_split",
      turn: state.turn,
      phase: spec.phaseId,
      summary: `${player_slot} used Pain Split (${attacker.name}: ${before_user_hp} -> ${after_user_hp}; ${defender.name}: ${before_target_hp} -> ${after_target_hp})`,
      data: {
        slot: player_slot,
        user: attacker.id,
        target: defender.id,
        userBefore: before_user_hp,
        userAfter: after_user_hp,
        targetBefore: before_target_hp,
        targetAfter: after_target_hp
      }
    });
    log.push({
      type: "move_detail",
      turn: state.turn,
      phase: spec.phaseId,
      summary: `Pain Split: both HP set to floor((userHP + targetHP)/2) = ${shared_hp}`,
      data: {
        move: spec.id,
        slot: player_slot,
        user: attacker.id,
        target: defender.id,
        sharedHp: shared_hp,
        userBefore: before_user_hp,
        userAfter: after_user_hp,
        targetBefore: before_target_hp,
        targetAfter: after_target_hp
      }
    });
    finalize_move_success();
    return;
  }

  apply_damage_move(
    state,
    log,
    player_slot,
    spec,
    hp_changed,
    spec.phaseId,
    took_damage_this_turn,
    damage_taken_this_turn,
    incoming_damage_multiplier_percent
  );
  finalize_move_success();
}

type SwitchTargetError = "invalid switch target" | "already active" | "target fainted";

function validate_switch_target(player: PlayerState, target_index: number): SwitchTargetError | null {
  if (target_index < 0 || target_index >= player.team.length) {
    return "invalid switch target";
  }
  if (target_index === player.activeIndex) {
    return "already active";
  }
  if (!is_alive(player.team[target_index])) {
    return "target fainted";
  }
  return null;
}

function reset_monster_on_switch_out(monster: MonsterState): void {
  monster.attack = monster.baseAttack;
  monster.attackStage = 0;
  monster.defense = monster.baseDefense;
  monster.defenseStage = 0;
  monster.speed = monster.baseSpeed;
  monster.speedStage = 0;
  monster.agilityBoostActive = false;
  monster.specialProtectActiveThisTurn = false;
  monster.endureSpeedBoostActive = false;
  monster.baitActiveThisTurn = false;
  monster.bellyDrumActive = false;
  monster.screechDebuffActive = false;
}

function perform_switch(
  state: GameState,
  log: EventLog[],
  slot: PlayerSlot,
  target_index: number,
  event_type: "switch" | "forced_switch",
  hp_changed?: WeakSet<MonsterState>,
  took_damage_this_turn?: Record<PlayerSlot, boolean>,
  damage_taken_this_turn?: Record<PlayerSlot, number>,
  incoming_damage_multiplier_percent?: Record<PlayerSlot, number>
): void {
  ensure_state_runtime_defaults(state);
  const player = state.players[slot];
  const from = player.activeIndex;
  const outgoing = player.team[from];
  reset_monster_on_switch_out(outgoing);
  reset_fervor_chain(state, slot);
  clear_curses_on_target_switch(state, log, slot);
  clear_buff_debuffs_on_target_switch(state, log, slot);
  clear_heal_buffs_on_target_switch(state, log, slot);
  player.activeIndex = target_index;
  sync_player_shared_hp(state, slot, player.sharedHp);
  sync_player_shared_mSPE(state, slot, player.sharedMSPE);
  refresh_active_monster_stats_for_slot(state, slot);
  apply_spikes_on_switch(
    state,
    log,
    slot,
    hp_changed,
    took_damage_this_turn,
    damage_taken_this_turn,
    incoming_damage_multiplier_percent
  );
  log.push({
    type: event_type,
    turn: state.turn,
    summary: `${slot} switched to ${player.team[target_index].name}`,
    data: { slot, from, to: target_index }
  });
}

function apply_switch(
  state: GameState,
  log: EventLog[],
  player_slot: PlayerSlot,
  targetIndex: number,
  hp_changed?: WeakSet<MonsterState>,
  took_damage_this_turn?: Record<PlayerSlot, boolean>,
  damage_taken_this_turn?: Record<PlayerSlot, number>,
  incoming_damage_multiplier_percent?: Record<PlayerSlot, number>
): boolean {
  const player = state.players[player_slot];
  const error = validate_switch_target(player, targetIndex);
  if (error) {
    const summary =
      error === "invalid switch target"
        ? `${player_slot} invalid switch`
        : error === "already active"
          ? `${player_slot} already active`
          : `${player_slot} cannot switch to fainted`;
    log.push({
      type: "switch_invalid",
      turn: state.turn,
      summary,
      data: { slot: player_slot, targetIndex, error }
    });
    return false;
  }
  perform_switch(
    state,
    log,
    player_slot,
    targetIndex,
    "switch",
    hp_changed,
    took_damage_this_turn,
    damage_taken_this_turn,
    incoming_damage_multiplier_percent
  );
  return true;
}

function build_actions(intents: Record<PlayerSlot, PlayerIntent | null>, state: GameState): Action[] {
  const actions: Action[] = [];
  for (const slot of SLOT_ORDER) {
    const intent = intents[slot];
    if (!intent) continue;
    if (intent.action === "switch") {
      actions.push({ player: slot, type: "switch", phase: "switch", targetIndex: intent.targetIndex });
    } else if (intent.action === "run") {
      actions.push({ player: slot, type: "run", phase: "run" });
    } else {
      const player = state.players[slot];
      const active = active_monster(player);
      const moveId = active.chosenMoves[intent.moveIndex] ?? "none";
      if (moveId === "run") {
        actions.push({ player: slot, type: "run", phase: "run" });
        continue;
      }
      const spec = move_spec(moveId);
      actions.push({
        player: slot,
        type: "move",
        phase: spec.phaseId,
        moveId,
        moveIndex: intent.moveIndex
      });
    }
  }
  return actions;
}

export function create_initial_state(
  teams: Record<PlayerSlot, TeamSelection>,
  names: Record<PlayerSlot, string>
): GameState {
  const read_ev_component = (source: Partial<EVSpread>, key: keyof EVSpread): number => {
    const raw = source[key];
    if (raw === undefined) {
      return 0;
    }
    return typeof raw === "number" ? raw : Number.NaN;
  };

  const normalize_ev = (value: unknown): EVSpread => {
    const source = (typeof value === "object" && value !== null ? value : {}) as Partial<EVSpread>;
    return {
      hp: read_ev_component(source, "hp"),
      atk: read_ev_component(source, "atk"),
      def: read_ev_component(source, "def"),
      spe: read_ev_component(source, "spe")
    };
  };

  const build_player = (slot: PlayerSlot): PlayerState => {
    const selection = teams[slot];
    const shared_hp = SHARED_HP_START;
    const shared_mSPE = SHARED_MSPE_START;
    const team = selection.monsters.map((monster) => {
      const spec = MONSTER_BY_ID.get(monster.id);
      if (!spec) {
        throw new Error(`team invalid: unknown monster id ${monster.id}`);
      }
      const level_input = typeof monster.stats?.level === "number" ? monster.stats.level : spec.stats.level;
      const normalized_level = normalize_int(level_input, spec.stats.level, LEVEL_MIN);
      const level = Math.min(LEVEL_MAX, normalized_level);
      const ev = normalize_ev(monster.ev);
      const ev_error = validate_ev_spread(ev);
      if (ev_error) {
        throw new Error(`team invalid (${monster.id}): ${ev_error}`);
      }
      const final_stats = calc_final_stats(
        {
          hp: spec.stats.maxHp,
          atk: spec.stats.attack,
          def: spec.stats.defense,
          spe: spec.stats.speed
        },
        level,
        ev
      );
      const resolved_type: MonsterType =
        monster.type === "buf" || monster.type === "def" || monster.type === "atk" ? monster.type : spec.type;
      return {
        id: monster.id,
        name: monster.id,
        type: resolved_type,
        hp: shared_hp,
        maxHp: shared_hp,
        mSPE: shared_mSPE,
        level,
        baseAttack: final_stats.atk,
        baseDefense: final_stats.def,
        baseSpeed: final_stats.spe,
        attack: final_stats.atk,
        attackStage: 0,
        defense: final_stats.def,
        defenseStage: 0,
        speed: final_stats.spe,
        speedStage: 0,
        agilityBoostActive: false,
        endureSpeedBoostActive: false,
        bellyDrumActive: false,
        screechDebuffActive: false,
        possibleMoves: monster.moves.slice(),
        possiblePassives: [monster.passive],
        chosenMoves: monster.moves.slice(0, 3),
        chosenPassive: monster.passive,
        protectActiveThisTurn: false,
        specialProtectActiveThisTurn: false,
        endureActiveThisTurn: false,
        baitActiveThisTurn: false,
        protectCooldownTurns: 0,
        specialProtectCooldownTurns: 0,
        endureCooldownTurns: 0
      };
    });
    return {
      slot,
      name: names[slot],
      sharedHp: shared_hp,
      sharedHpMax: shared_hp,
      sharedMSPE: shared_mSPE,
      team,
      activeIndex: Math.min(Math.max(selection.activeIndex, 0), team.length - 1)
    };
  };

  const initial_state: GameState = {
    turn: 0,
    status: "setup",
    endReason: undefined,
    mSPESlots: undefined,
    baseTurnLimit: BASE_TURN_LIMIT,
    rpsScore: empty_rps_score(),
    mSPETelemetry: empty_mSPE_telemetry(),
    typePassiveArmorStacks: empty_type_passive_armor_stacks(),
    typePassiveRegenStacks: empty_type_passive_regen_stacks(),
    rejuvenationStacks: empty_rejuvenation_stacks(),
    rejuvenationStartTurn: empty_rejuvenation_start_turn(),
    fervorChainBySlot: empty_fervor_chain_by_slot(),
    arenaTrapUntilTurn: empty_arena_trap_until_turn(),
    spikesArmedByTarget: empty_spikes_armed_by_target(),
    players: {
      player1: build_player("player1"),
      player2: build_player("player2")
    },
    pendingSwitch: empty_pending(),
    pendingSwitchReason: empty_pending_switch_reason(),
    pendingSwitchResolvedThisTurn: empty_pending_switch_resolved_this_turn(),
    pendingWish: empty_pending_wish(),
    tauntUntilTurn: empty_taunt_until_turn(),
    activeEffectsBySlot: empty_active_effects(),
    activeCursesBySlot: empty_active_curses(),
    activeBuffDebuffsBySlot: empty_active_buff_debuffs(),
    activeHealBuffsBySlot: empty_active_heal_buffs(),
    lastMoveIndexBySlot: empty_last_move_index(),
  };
  sync_all_players_shared_hp(initial_state);
  sync_all_players_shared_mSPE(initial_state);
  refresh_active_monster_stats(initial_state);
  refresh_mSPE_telemetry(initial_state);
  return initial_state;
}

export function resolve_turn(
  state: GameState,
  intents: Record<PlayerSlot, PlayerIntent | null>
): { state: GameState; log: EventLog[] } {
  const next = clone_state(state);
  const log: EventLog[] = [];
  const hp_changed_this_turn = new WeakSet<MonsterState>();
  const focus_punch_pending: Record<PlayerSlot, boolean> = { player1: false, player2: false };
  const took_damage_this_turn: Record<PlayerSlot, boolean> = { player1: false, player2: false };
  const damage_taken_this_turn: Record<PlayerSlot, number> = { player1: 0, player2: 0 };
  const hook_run_blocked_this_turn: Record<PlayerSlot, boolean> = { player1: false, player2: false };
  const incoming_damage_multiplier_percent: Record<PlayerSlot, number> = { player1: 100, player2: 100 };
  const rejuvenation_used_this_turn: Record<PlayerSlot, boolean> = { player1: false, player2: false };
  const pending_happiness_apply_by_slot: Record<PlayerSlot, boolean> = { player1: false, player2: false };
  sync_all_players_shared_hp(next);
  sync_all_players_shared_mSPE(next);
  refresh_active_monster_stats(next);
  next.baseTurnLimit = Math.max(1, normalize_int(next.baseTurnLimit, BASE_TURN_LIMIT, 1));

  if (next.status !== "running") {
    return { state: next, log };
  }

  ensure_state_runtime_defaults(next);
  const switch_sovietico_resolved_this_turn: Record<PlayerSlot, boolean> = {
    player1: !!next.pendingSwitchResolvedThisTurn.player1,
    player2: !!next.pendingSwitchResolvedThisTurn.player2
  };
  const switched_this_turn: Record<PlayerSlot, boolean> = {
    player1: switch_sovietico_resolved_this_turn.player1,
    player2: switch_sovietico_resolved_this_turn.player2
  };
  next.pendingSwitch = empty_pending();
  next.pendingSwitchReason = empty_pending_switch_reason();
  next.pendingSwitchResolvedThisTurn = empty_pending_switch_resolved_this_turn();

  const intents_after_forced_switch: Record<PlayerSlot, PlayerIntent | null> = {
    player1: intents.player1,
    player2: intents.player2
  };
  for (const slot_id of SLOT_ORDER) {
    if (!switch_sovietico_resolved_this_turn[slot_id]) {
      continue;
    }
    if (intents_after_forced_switch[slot_id] !== null) {
      log.push({
        type: "action_skipped",
        turn: next.turn,
        phase: "switch",
        summary: `${slot_id} cannot act this turn after Switch Sovietico forced switch`,
        data: { slot: slot_id, reason: "switch_sovietico_forced_switch" }
      });
    }
    intents_after_forced_switch[slot_id] = null;
  }

  const actions = build_actions(intents_after_forced_switch, next);
  reset_protect_flags(next);
  let progress = check_zero_hp_match_result(next, log);
  const phases = [...PHASES].sort((a, b) => a.order - b.order);
  let mindgame_checked = false;

  for (const phase of phases) {
    if (progress !== "continue") {
      break;
    }
    if (phase.id === "switch" && !mindgame_checked) {
      progress = check_mSPE_match_result(next, log);
      if (progress !== "continue") {
        break;
      }
      const sovietico_bonus_applied = apply_switch_sovietico_predict_bonus(
        next,
        log,
        switch_sovietico_resolved_this_turn,
        hp_changed_this_turn,
        took_damage_this_turn,
        damage_taken_this_turn,
        incoming_damage_multiplier_percent
      );
      if (!sovietico_bonus_applied) {
        apply_mindgame_bonus_event(next, log, actions);
      }
      mindgame_checked = true;
      progress = check_zero_hp_match_result(next, log);
      if (progress !== "continue") {
        break;
      }
    }
    const phase_actions = actions.filter((action) => action.phase === phase.id);
    if (phase_actions.length === 0) {
      continue;
    }

    if (phase_actions.length >= 2) {
      phase_actions.sort((a, b) => compare_actions_for_phase(next, phase, a, b));
      const first = phase_actions[0];
      log.push({
        type: "initiative",
        turn: next.turn,
        phase: phase.id,
        summary: `${first.player} acts first in ${phase.name}`,
        data: { phase: phase.id }
      });
    }

    for (const action of phase_actions) {
      if (action.type === "switch") {
        const blocked_switch_reason = switch_block_reason(next, action.player);
        if (!blocked_switch_reason) {
          const switched = apply_switch(
            next,
            log,
            action.player,
            action.targetIndex,
            hp_changed_this_turn,
            took_damage_this_turn,
            damage_taken_this_turn,
            incoming_damage_multiplier_percent
          );
          if (switched) {
            switched_this_turn[action.player] = true;
          }
        } else {
          const blocked_type = blocked_switch_reason === "taunt" ? "taunt_blocked" : "switch_blocked";
          const summary =
            blocked_switch_reason === "arena trapped"
              ? `${action.player} cannot switch (arena trapped)`
              : blocked_switch_reason === "taunt"
                ? `${action.player} is taunted and cannot switch`
                : `${action.player} cannot switch (${effect_label(blocked_switch_reason)})`;
          log.push({
            type: blocked_type,
            turn: next.turn,
            phase: phase.id,
            summary,
            data: {
              slot: action.player,
              targetIndex: action.targetIndex,
              reason: blocked_switch_reason,
              turnsRemaining:
                blocked_switch_reason === "arena trapped"
                  ? Math.max(0, (next.arenaTrapUntilTurn?.[action.player] ?? 0) - next.turn + 1)
                  : EFFECT_ID_SET.has(blocked_switch_reason)
                    ? effect_turns_remaining(next, action.player, blocked_switch_reason as EffectCollateralId)
                    : 0
            }
          });
        }
      } else if (action.type === "move") {
        apply_move(
          next,
          log,
          action.player,
          action.moveId,
          action.moveIndex,
          hp_changed_this_turn,
          focus_punch_pending,
          took_damage_this_turn,
          damage_taken_this_turn,
          rejuvenation_used_this_turn,
          hook_run_blocked_this_turn,
          incoming_damage_multiplier_percent,
          pending_happiness_apply_by_slot
        );
      } else {
        apply_run_action(next, log, action.player, hook_run_blocked_this_turn[action.player]);
      }
      progress = check_zero_hp_match_result(next, log);
      if (progress !== "continue") {
        break;
      }
    }
    if (phase.id === "switch" && progress === "continue") {
      apply_simultaneous_switch_passives(
        next,
        log,
        switched_this_turn,
        hp_changed_this_turn,
        took_damage_this_turn,
        damage_taken_this_turn,
        incoming_damage_multiplier_percent
      );
      progress = check_zero_hp_match_result(next, log);
    } else if (phase.id === "run" && progress === "continue") {
      progress = check_mSPE_match_result(next, log);
    }
  }

  if (progress === "continue") {
    progress = apply_end_turn_phase(
      next,
      log,
      hp_changed_this_turn,
      focus_punch_pending,
      took_damage_this_turn,
      switched_this_turn,
      rejuvenation_used_this_turn,
      damage_taken_this_turn,
      incoming_damage_multiplier_percent,
      pending_happiness_apply_by_slot
    );
  }
  decrement_cooldowns(next);
  if (next.status === "running") {
    decay_effects_end_turn(next, log);
    decay_curses_end_turn(next, log);
  }
  refresh_active_monster_stats(next);
  // Clear guard flags after the turn resolves (so next turn starts unprotected/not-enduring).
  reset_protect_flags(next);

  if (next.status === "running") {
    maybe_end_match_by_turn_limit(next, log);
  }
  refresh_mSPE_telemetry(next);

  return { state: next, log };
}

export function apply_forced_switch(
  state: GameState,
  slot: PlayerSlot,
  targetIndex: number
): { state: GameState; log: EventLog[]; error?: string } {
  const next = clone_state(state);
  const log: EventLog[] = [];
  ensure_state_runtime_defaults(next);
  const player = next.players[slot];
  if (!next.pendingSwitch[slot]) {
    return { state: next, log, error: "no pending switch" };
  }
  const error = validate_switch_target(player, targetIndex);
  if (error) {
    return { state: next, log, error };
  }
  const switch_reason = next.pendingSwitchReason?.[slot] ?? "none";
  perform_switch(next, log, slot, targetIndex, "forced_switch");
  next.pendingSwitch[slot] = false;
  next.pendingSwitchReason[slot] = "none";
  next.pendingSwitchResolvedThisTurn[slot] = switch_reason === "switch_sovietico";
  refresh_mSPE_telemetry(next);
  return { state: next, log };
}

export function validate_intent(state: GameState, slot: PlayerSlot, intent: PlayerIntent): string | null {
  const player = state.players[slot];
  if (!player) {
    return "unknown player";
  }
  if (state.pendingSwitch?.[slot]) {
    return "pending switch";
  }
  if (intent.action === "switch") {
    const blocked_switch = switch_block_reason(state, slot);
    if (blocked_switch === "taunt") {
      return "taunted: must use attack";
    }
    if (blocked_switch) {
      return blocked_switch;
    }
    const switch_error = validate_switch_target(player, intent.targetIndex);
    if (switch_error) {
      return switch_error;
    }
    return null;
  }
  if (intent.action === "run") {
    const blocked_run = run_block_reason(state, slot);
    if (blocked_run === "nocaute") {
      return "nocaute: must switch";
    }
    if (blocked_run === "taunt") {
      return "taunted: must use attack";
    }
    if (blocked_run) {
      return blocked_run;
    }
    return null;
  }

  const active = active_monster(player);
  if (intent.moveIndex < 0 || intent.moveIndex >= active.chosenMoves.length) {
    return "invalid move index";
  }

  const moveId = active.chosenMoves[intent.moveIndex] ?? "none";
  if (moveId === "run") {
    const blocked_run = run_block_reason(state, slot);
    if (blocked_run === "nocaute") {
      return "nocaute: must switch";
    }
    if (blocked_run === "taunt") {
      return "taunted: must use attack";
    }
    if (blocked_run) {
      return blocked_run;
    }
    return null;
  }
  const spec = move_spec(moveId);
  const blocked_move = move_block_reason(state, slot, intent.moveIndex, spec);
  if (blocked_move === "nocaute") {
    return "nocaute: must switch";
  }
  if (blocked_move === "taunt") {
    return "taunted: must use attack";
  }
  if (blocked_move) {
    return blocked_move;
  }

  const guard_cooldown = Math.max(active.protectCooldownTurns, active.endureCooldownTurns);
  if (moveId === "protect" && guard_cooldown > 0) {
    return "protect on cooldown";
  }
  if (moveId === "endure" && guard_cooldown > 0) {
    return "endure on cooldown";
  }
  if (moveId === "special_protect" && Math.max(0, normalize_int(active.specialProtectCooldownTurns, 0, 0)) > 0) {
    return "special protect on cooldown";
  }
  if (moveId === "switch_sovietico") {
    if (!has_available_switch_target(player)) {
      return "switch sovietico requires available switch target";
    }
  }

  return null;
}
