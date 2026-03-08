import type { EventLog, GameState, PlayerSlot } from "../shared.ts";
import { active_monster } from "./combat_state.ts";

export function is_attack_damage_phase(phase: string): boolean {
  return phase === "attack_01" || phase === "attack_02";
}

export function is_special_protect_blocking_target_effect(
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

export function log_special_protect_block(
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
