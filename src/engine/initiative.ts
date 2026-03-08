import type { GameState, MonsterState, PlayerSlot } from "../shared.ts";
import { INITIATIVE_WITHOUT_SPEED, type Action, type Phase } from "./constants.ts";
import { active_monster } from "./combat_state.ts";
import {
  effective_attack_for_slot,
  effective_defense_for_slot,
  effective_speed_for_slot
} from "./monster_stats.ts";

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

export function compare_action_initiative(state: GameState, phase: Phase, a: Action, b: Action): number {
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

export function compare_actions_for_phase(state: GameState, phase: Phase, a: Action, b: Action): number {
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
