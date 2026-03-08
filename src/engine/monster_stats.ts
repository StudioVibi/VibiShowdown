import type {
  ActiveBuffDebuffState,
  BuffDebuffStat,
  GameState,
  MonsterState,
  PlayerSlot
} from "../shared.ts";
import {
  ATTACK_STAGE_BUFF_IDS,
  POWER_ATTACK_STAGE_BUFF_IDS,
  POWER_ATTACK_STAGE_PER_CAST,
  STAT_STAGE_MAX
} from "./constants.ts";
import { active_monster } from "./combat_state.ts";
import { buff_debuff_list, curse_list, has_effect } from "./state_helpers.ts";
import {
  attack_from_stage,
  clamp_stat_stage,
  normalize_stat_stage,
  stat_value_from_delta_percent,
  stat_value_from_delta_percent_and_stage
} from "./stat_math.ts";

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

export function effective_attack_stage_for_monster(state: GameState, slot: PlayerSlot, monster: MonsterState): number {
  const mirror_source_slot = mirror_source_slot_for_target(state, slot);
  if (mirror_source_slot) {
    const source_monster = active_monster(state.players[mirror_source_slot]);
    return local_attack_stage_without_mirror(state, mirror_source_slot, source_monster);
  }
  return local_attack_stage_without_mirror(state, slot, monster);
}

export function total_delta_percent_from_buff_debuffs(
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

export function refresh_active_monster_stats_for_slot(state: GameState, slot: PlayerSlot): void {
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

export function refresh_active_monster_stats(state: GameState): void {
  refresh_active_monster_stats_for_slot(state, "player1");
  refresh_active_monster_stats_for_slot(state, "player2");
}

export function effective_attack_for_slot(state: GameState, slot: PlayerSlot, monster: MonsterState): number {
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

export function effective_defense_for_slot(state: GameState, slot: PlayerSlot, monster: MonsterState): number {
  refresh_active_monster_stats_for_slot(state, slot);
  if (has_effect(state, slot, "deterioration")) {
    return 0;
  }
  return monster.defense;
}

export function effective_speed_for_slot(state: GameState, slot: PlayerSlot, monster: MonsterState): number {
  refresh_active_monster_stats_for_slot(state, slot);
  if (has_effect(state, slot, "paralyse")) {
    return 0;
  }
  return monster.speed;
}
