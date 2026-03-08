import type { CurseCollateralId, EffectCollateralId } from "../data/types.ts";
import { normalize_int } from "../int_math.ts";
import { SHARED_MSPE_START } from "../shared.ts";
import type {
  ActiveBuffDebuffState,
  ActiveCurseState,
  ActiveEffectState,
  ActiveHealBuffState,
  BuffDebuffStat,
  GameState,
  MSPETelemetry,
  MonsterState,
  PendingSwitchReason,
  PlayerSlot
} from "../shared.ts";
import {
  CURSE_ID_SET,
  CURSE_LABELS,
  EFFECT_ID_SET,
  EFFECT_LABELS,
  MSPE_GAP_GOAL_PERCENT,
  MSPE_VALUE_GOAL
} from "./constants.ts";
import { infer_stage_from_attack, normalize_stat_stage } from "./stat_math.ts";

export function clone_monster(monster: MonsterState): MonsterState {
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

export function empty_slot_record<T>(player1: T, player2: T): Record<PlayerSlot, T> {
  return { player1, player2 };
}

export function empty_pending(): Record<PlayerSlot, boolean> {
  return empty_slot_record(false, false);
}

export function empty_pending_switch_reason(): Record<PlayerSlot, PendingSwitchReason> {
  return empty_slot_record<PendingSwitchReason>("none", "none");
}

export function empty_pending_switch_resolved_this_turn(): Record<PlayerSlot, boolean> {
  return empty_slot_record(false, false);
}

export function empty_rps_score(): Record<PlayerSlot, number> {
  return empty_slot_record(0, 0);
}

export function empty_type_passive_armor_stacks(): Record<PlayerSlot, number> {
  return empty_slot_record(0, 0);
}

export function empty_type_passive_regen_stacks(): Record<PlayerSlot, number> {
  return empty_slot_record(0, 0);
}

export function empty_rejuvenation_stacks(): Record<PlayerSlot, number> {
  return empty_slot_record(0, 0);
}

export function empty_rejuvenation_start_turn(): Record<PlayerSlot, number> {
  return empty_slot_record(0, 0);
}

export function empty_fervor_chain_by_slot(): Record<PlayerSlot, number> {
  return empty_slot_record(0, 0);
}

export function empty_pending_wish(): Record<PlayerSlot, number | null> {
  return empty_slot_record<number | null>(null, null);
}

export function empty_taunt_until_turn(): Record<PlayerSlot, number> {
  return empty_slot_record(0, 0);
}

export function empty_active_effects(): Record<PlayerSlot, ActiveEffectState[]> {
  return empty_slot_record([], []);
}

export function empty_active_buff_debuffs(): Record<PlayerSlot, ActiveBuffDebuffState[]> {
  return empty_slot_record([], []);
}

export function empty_active_heal_buffs(): Record<PlayerSlot, ActiveHealBuffState[]> {
  return empty_slot_record([], []);
}

export function empty_last_move_index(): Record<PlayerSlot, number | null> {
  return empty_slot_record<number | null>(null, null);
}

export function empty_mSPE_telemetry(): Record<PlayerSlot, MSPETelemetry> {
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

export function empty_active_curses(): Record<PlayerSlot, ActiveCurseState[]> {
  return empty_slot_record([], []);
}

export function empty_arena_trap_until_turn(): Record<PlayerSlot, number> {
  return empty_slot_record(0, 0);
}

export function empty_spikes_armed_by_target(): Record<PlayerSlot, boolean> {
  return empty_slot_record(false, false);
}

export function effect_label(effect_id: string): string {
  if (effect_id in EFFECT_LABELS) {
    return EFFECT_LABELS[effect_id as EffectCollateralId];
  }
  return effect_id;
}

export function curse_label(curse_id: string): string {
  if (curse_id in CURSE_LABELS) {
    return CURSE_LABELS[curse_id as CurseCollateralId];
  }
  return curse_id;
}

export function normalize_active_effects(input: unknown): ActiveEffectState[] {
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

export function normalize_active_curses(input: unknown): ActiveCurseState[] {
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

export function normalize_active_buff_debuffs(input: unknown): ActiveBuffDebuffState[] {
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

export function normalize_active_heal_buffs(input: unknown): ActiveHealBuffState[] {
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

export function effect_list(state: GameState, slot: PlayerSlot): ActiveEffectState[] {
  return state.activeEffectsBySlot?.[slot] ?? [];
}

export function curse_list(state: GameState, slot: PlayerSlot): ActiveCurseState[] {
  return state.activeCursesBySlot?.[slot] ?? [];
}

export function buff_debuff_list(state: GameState, slot: PlayerSlot): ActiveBuffDebuffState[] {
  return state.activeBuffDebuffsBySlot?.[slot] ?? [];
}

export function heal_buff_list(state: GameState, slot: PlayerSlot): ActiveHealBuffState[] {
  return state.activeHealBuffsBySlot?.[slot] ?? [];
}

export function effect_state(state: GameState, slot: PlayerSlot, effect_id: EffectCollateralId): ActiveEffectState | null {
  for (const effect of effect_list(state, slot)) {
    if (effect.id === effect_id) {
      return effect;
    }
  }
  return null;
}

export function curse_state(state: GameState, slot: PlayerSlot, curse_id: CurseCollateralId): ActiveCurseState | null {
  for (const curse of curse_list(state, slot)) {
    if (curse.id === curse_id) {
      return curse;
    }
  }
  return null;
}

export function heal_buff_state(state: GameState, slot: PlayerSlot, heal_buff_id: string): ActiveHealBuffState | null {
  for (const buff of heal_buff_list(state, slot)) {
    if (buff.id === heal_buff_id) {
      return buff;
    }
  }
  return null;
}

export function has_effect(state: GameState, slot: PlayerSlot, effect_id: EffectCollateralId): boolean {
  return !!effect_state(state, slot, effect_id);
}

export function has_curse(state: GameState, slot: PlayerSlot, curse_id: CurseCollateralId): boolean {
  return !!curse_state(state, slot, curse_id);
}

export function curse_stacks(state: GameState, slot: PlayerSlot, curse_id: CurseCollateralId): number {
  return curse_state(state, slot, curse_id)?.stacks ?? 0;
}

export function curse_turns_remaining(state: GameState, slot: PlayerSlot, curse_id: CurseCollateralId): number {
  const remaining = curse_state(state, slot, curse_id)?.remainingTurns;
  if (typeof remaining !== "number" || !Number.isFinite(remaining)) {
    return 0;
  }
  return Math.max(0, normalize_int(remaining, 0, 0));
}

export function effect_turns_remaining(state: GameState, slot: PlayerSlot, effect_id: EffectCollateralId): number {
  return effect_state(state, slot, effect_id)?.remainingTurns ?? 0;
}
