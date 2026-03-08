import { normalize_int } from "../int_math.ts";
import { SHARED_HP_START, SHARED_MSPE_START } from "../shared.ts";
import type { GameState, MonsterState, PlayerSlot, PlayerState } from "../shared.ts";
import { SLOT_ORDER } from "./constants.ts";

export function active_monster(player: PlayerState): MonsterState {
  return player.team[player.activeIndex];
}

export function other_slot(slot: PlayerSlot): PlayerSlot {
  return slot === "player1" ? "player2" : "player1";
}

export function sync_player_shared_hp(state: GameState, slot: PlayerSlot, next_hp: number): number {
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

export function sync_player_shared_mSPE(state: GameState, slot: PlayerSlot, next_mSPE: number): number {
  const player = state.players[slot];
  const clamped = Math.max(0, normalize_int(next_mSPE, SHARED_MSPE_START, 0));
  player.sharedMSPE = clamped;
  for (const monster of player.team) {
    monster.mSPE = clamped;
  }
  return clamped;
}

export function sync_all_players_shared_hp(state: GameState): void {
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

export function sync_all_players_shared_mSPE(state: GameState): void {
  for (const slot of SLOT_ORDER) {
    const player = state.players[slot];
    const active = player.team[player.activeIndex] ?? player.team[0];
    const fallback_shared_mSPE = active ? normalize_int(active.mSPE, SHARED_MSPE_START, 0) : SHARED_MSPE_START;
    const shared_mSPE = Math.max(0, normalize_int(player.sharedMSPE, fallback_shared_mSPE, 0));
    sync_player_shared_mSPE(state, slot, shared_mSPE);
  }
}
