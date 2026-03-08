import type { MonsterState, PlayerState } from "../shared.ts";
import { is_alive } from "./turn_helpers.ts";

export type SwitchTargetError = "invalid switch target" | "already active" | "target fainted";

export function validate_switch_target(player: PlayerState, target_index: number): SwitchTargetError | null {
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

export function reset_monster_on_switch_out(monster: MonsterState): void {
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
