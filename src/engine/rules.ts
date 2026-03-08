import type { GameState, PlayerSlot, PlayerState } from "../shared.ts";
import { normalize_int } from "../int_math.ts";
import {
  REJUVENATION_REGEN_STACK_MAX,
  TAUNT_BLOCKED_MOVE_IDS,
  TYPE_PASSIVE_DEF_ARMOR_STACK_MAX
} from "./constants.ts";
import { has_curse, has_effect, effect_label } from "./state_helpers.ts";

export function normalize_type_passive_stack(value: unknown, fallback: number, min: number, max: number): number {
  const raw = typeof value === "number" ? value : fallback;
  return Math.max(min, Math.min(max, normalize_int(raw, fallback, min)));
}

export function is_slot_arena_trapped(state: GameState, slot: PlayerSlot): boolean {
  const trapped_until = state.arenaTrapUntilTurn?.[slot] ?? 0;
  return trapped_until > 0 && trapped_until >= state.turn;
}

export function type_passive_armor_stack(state: GameState, slot: PlayerSlot): number {
  return normalize_type_passive_stack(
    state.typePassiveArmorStacks?.[slot],
    0,
    0,
    TYPE_PASSIVE_DEF_ARMOR_STACK_MAX
  );
}

export function type_passive_regen_stack(state: GameState, slot: PlayerSlot): number {
  return normalize_type_passive_stack(state.typePassiveRegenStacks?.[slot], 0, 0, 9999);
}

export function rejuvenation_stack(state: GameState, slot: PlayerSlot): number {
  return normalize_type_passive_stack(state.rejuvenationStacks?.[slot], 0, 0, REJUVENATION_REGEN_STACK_MAX);
}

export function rejuvenation_start_turn(state: GameState, slot: PlayerSlot): number {
  return normalize_int(state.rejuvenationStartTurn?.[slot], 0, 0);
}

export function is_slot_clear_body_active(state: GameState, slot: PlayerSlot): boolean {
  return type_passive_armor_stack(state, slot) > 0;
}

export function is_slot_taunted(state: GameState, slot: PlayerSlot): boolean {
  return (state.tauntUntilTurn?.[slot] ?? 0) >= state.turn || has_effect(state, slot, "taunt");
}

export function is_attack_move(spec: { id: string; phaseId: string }): boolean {
  if (spec.phaseId !== "attack_01") {
    return false;
  }
  return !TAUNT_BLOCKED_MOVE_IDS.has(spec.id);
}

export function is_skill_move(spec: { id: string; phaseId: string }): boolean {
  return !is_attack_move(spec);
}

function is_alive_monster(max_hp: number): boolean {
  return max_hp > 0;
}

export function first_available_switch_target(player: PlayerState): number | null {
  for (let index = 0; index < player.team.length; index++) {
    if (index === player.activeIndex) {
      continue;
    }
    if (is_alive_monster(player.team[index].maxHp)) {
      return index;
    }
  }
  return null;
}

export function has_available_switch_target(player: PlayerState): boolean {
  return first_available_switch_target(player) !== null;
}

export function switch_block_reason(state: GameState, slot: PlayerSlot): string | null {
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

export function move_block_reason(
  state: GameState,
  slot: PlayerSlot,
  move_index: number,
  spec: { id: string; phaseId: string }
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

export function run_block_reason(state: GameState, slot: PlayerSlot): string | null {
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

export function move_block_summary(slot: PlayerSlot, reason: string, spec_label: string): string {
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
