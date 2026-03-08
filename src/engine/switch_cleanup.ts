import type {
  ActiveCurseState,
  BuffDebuffStat,
  EventLog,
  GameState,
  PlayerSlot
} from "../shared.ts";
import {
  curse_label,
  empty_active_buff_debuffs,
  empty_active_curses,
  empty_active_heal_buffs
} from "./state_helpers.ts";
import { refresh_active_monster_stats_for_slot } from "./monster_stats.ts";

export function clear_curses_on_target_switch(state: GameState, log: EventLog[], target_slot: PlayerSlot): void {
  if (!state.activeCursesBySlot) {
    state.activeCursesBySlot = empty_active_curses();
  }
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

export function clear_buff_debuffs_on_target_switch(state: GameState, log: EventLog[], target_slot: PlayerSlot): void {
  if (!state.activeBuffDebuffsBySlot) {
    state.activeBuffDebuffsBySlot = empty_active_buff_debuffs();
  }
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

export function clear_heal_buffs_on_target_switch(state: GameState, log: EventLog[], target_slot: PlayerSlot): void {
  if (!state.activeHealBuffsBySlot) {
    state.activeHealBuffsBySlot = empty_active_heal_buffs();
  }
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

export function clear_buff_debuffs_for_stat(state: GameState, slot: PlayerSlot, stat: BuffDebuffStat): number {
  if (!state.activeBuffDebuffsBySlot) {
    state.activeBuffDebuffsBySlot = empty_active_buff_debuffs();
  }
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
