import { normalize_int, mul_div_ceil } from "../int_math.ts";
import type { GameState, MonsterState, PlayerState } from "../shared.ts";
import { SLOT_ORDER } from "./constants.ts";

export function is_alive(monster: MonsterState): boolean {
  return monster.maxHp > 0;
}

export function for_each_player(state: GameState, fn: (player: PlayerState) => void): void {
  for (const slot of SLOT_ORDER) {
    fn(state.players[slot]);
  }
}

export function reset_protect_flags(state: GameState): void {
  for_each_player(state, (player) => {
    for (const monster of player.team) {
      monster.protectActiveThisTurn = false;
      monster.specialProtectActiveThisTurn = false;
      monster.endureActiveThisTurn = false;
      monster.baitActiveThisTurn = false;
    }
  });
}

export function decrement_cooldowns(state: GameState): void {
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

export function minimum_endure_hp(monster: MonsterState): number {
  return Math.max(1, mul_div_ceil(monster.maxHp, 1, 100));
}
