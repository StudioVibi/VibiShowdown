import {
  BASE_TURN_LIMIT,
  SHARED_HP_START,
} from "./shared.ts";
import type {
  EVSpread,
  EventLog,
  GameState,
  MonsterType,
  MonsterState,
  MoveId,
  PlayerIntent,
  PlayerSlot,
  PlayerState,
  TeamSelection
} from "./shared.ts";
import { MONSTER_BY_ID } from "./data/pokemon.ts";
import { move_spec } from "./data/moves.ts";
import { mul_div_ceil, mul_div_floor, mul_div_round, normalize_int } from "./int_math.ts";
import { LEVEL_MAX, LEVEL_MIN, calc_final_stats, validate_ev_spread } from "./stats_calc.ts";

type Phase = {
  id: string;
  name: string;
  order: number;
  initiative: Array<keyof Pick<MonsterState, "speed" | "attack" | "hp" | "defense">>;
};

const INITIATIVE_DEFAULT: Phase["initiative"] = ["speed", "attack", "hp", "defense"];

const PHASES: Phase[] = [
  { id: "switch", name: "Switch", order: 0, initiative: INITIATIVE_DEFAULT },
  { id: "guard", name: "Guard", order: 1, initiative: INITIATIVE_DEFAULT },
  { id: "attack_01", name: "Attack 01", order: 2, initiative: INITIATIVE_DEFAULT }
];

const END_PHASE_ID = "end_turn";
const SLOT_ORDER = ["player1", "player2"] as const;
const END_TURN_EFFECT_ORDER = ["focus_punch", "wish", "leech_life"] as const;
type EndTurnEffectId = (typeof END_TURN_EFFECT_ORDER)[number];

const TAUNT_BLOCKED_MOVE_IDS = new Set([
  "none",
  "agility",
  "wish",
  "spikes",
  "recover",
  "meditate",
  "belly_drum",
  "screech",
  "taunt",
  "pain_split",
  "leech_life"
]);

type Action =
  | { player: PlayerSlot; type: "switch"; phase: string; targetIndex: number }
  | {
      player: PlayerSlot;
      type: "move";
      phase: string;
      moveId: MoveId;
      moveIndex: number;
      selfSwitchTargetIndex?: number;
    };

type MatchProgress = "continue" | "stop_turn" | "ended";

const INITIATIVE_WITHOUT_SPEED: Phase["initiative"] = ["attack", "hp", "defense"];
const STAT_STAGE_MIN = -6;
const STAT_STAGE_MAX = 6;

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

function attack_from_stage(base_attack: number, stage: number): number {
  const ratio = stage_ratio(stage);
  return Math.max(0, mul_div_round(base_attack, ratio.numerator, ratio.denominator));
}

function set_attack_stage(monster: MonsterState, next_stage: number): number {
  const normalized = clamp_stat_stage(next_stage);
  monster.attackStage = normalized;
  monster.attack = attack_from_stage(monster.baseAttack, normalized);
  return normalized;
}

function compare_action_initiative(state: GameState, phase: Phase, a: Action, b: Action): number {
  const a_active = active_monster(state.players[a.player]);
  const b_active = active_monster(state.players[b.player]);

  if (a.type === "move" && b.type === "move") {
    const a_quick = a.moveId === "quick_attack";
    const b_quick = b.moveId === "quick_attack";
    if (a_quick !== b_quick) {
      return a_quick ? 1 : -1;
    }
    if (a_quick && b_quick) {
      return compare_initiative(a_active, b_active, INITIATIVE_WITHOUT_SPEED);
    }
  }

  return compare_initiative(a_active, b_active, phase.initiative);
}

function action_type_order(action: Action): number {
  if (action.type === "move") return 0;
  return 1;
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
  return {
    id: monster.id,
    name: monster.name,
    type: monster.type,
    hp: monster.hp,
    maxHp: monster.maxHp,
    level: monster.level,
    baseAttack: base_attack,
    baseDefense: base_defense,
    baseSpeed: base_speed,
    attack: attack_from_stage(base_attack, attack_stage),
    attackStage: attack_stage,
    defense: monster.defense,
    speed: monster.speed,
    agilityBoostActive: !!monster.agilityBoostActive,
    endureSpeedBoostActive: !!monster.endureSpeedBoostActive,
    bellyDrumActive: !!monster.bellyDrumActive,
    screechDebuffActive: !!monster.screechDebuffActive,
    possibleMoves: monster.possibleMoves.slice(),
    possiblePassives: monster.possiblePassives.slice(),
    chosenMoves: monster.chosenMoves.slice(),
    chosenPassive: monster.chosenPassive,
    protectActiveThisTurn: monster.protectActiveThisTurn,
    endureActiveThisTurn: monster.endureActiveThisTurn,
    choiceBandLockedMoveIndex: monster.choiceBandLockedMoveIndex,
    protectCooldownTurns: monster.protectCooldownTurns,
    endureCooldownTurns: monster.endureCooldownTurns
  };
}

function empty_pending(): Record<PlayerSlot, boolean> {
  return { player1: false, player2: false };
}

function empty_rps_score(): Record<PlayerSlot, number> {
  return { player1: 0, player2: 0 };
}

function empty_pending_wish(): Record<PlayerSlot, number | null> {
  return { player1: null, player2: null };
}

function empty_taunt_until_turn(): Record<PlayerSlot, number> {
  return { player1: 0, player2: 0 };
}

function empty_arena_trap_until_turn(): Record<PlayerSlot, number> {
  return { player1: 0, player2: 0 };
}

function empty_leech_seed_active(): Record<PlayerSlot, boolean> {
  return { player1: false, player2: false };
}

function empty_leech_seed_sources(): Record<PlayerSlot, PlayerSlot | null> {
  return { player1: null, player2: null };
}

function empty_spikes_armed_by_target(): Record<PlayerSlot, boolean> {
  return { player1: false, player2: false };
}

function is_slot_taunted(state: GameState, slot: PlayerSlot): boolean {
  return (state.tauntUntilTurn?.[slot] ?? 0) >= state.turn;
}

function is_slot_arena_trapped(state: GameState, slot: PlayerSlot): boolean {
  const trapped_until = state.arenaTrapUntilTurn?.[slot] ?? 0;
  return trapped_until > 0 && trapped_until >= state.turn;
}

function is_attack_move(spec: { id: string; phaseId: string }): boolean {
  if (spec.phaseId !== "attack_01") {
    return false;
  }
  return !TAUNT_BLOCKED_MOVE_IDS.has(spec.id);
}

function clone_player(player: PlayerState): PlayerState {
  const active = player.team[player.activeIndex] ?? player.team[0];
  const fallback_max_hp = active ? normalize_int(active.maxHp, SHARED_HP_START, 1) : SHARED_HP_START;
  const shared_hp_max = Math.max(1, normalize_int(player.sharedHpMax, fallback_max_hp, 1));
  const fallback_shared_hp = active ? normalize_int(active.hp, shared_hp_max, 0) : shared_hp_max;
  const shared_hp = Math.max(0, Math.min(shared_hp_max, normalize_int(player.sharedHp, fallback_shared_hp, 0)));
  return {
    slot: player.slot,
    name: player.name,
    sharedHp: shared_hp,
    sharedHpMax: shared_hp_max,
    team: player.team.map(clone_monster),
    activeIndex: player.activeIndex
  };
}

export function clone_state(state: GameState): GameState {
  const cloned: GameState = {
    turn: state.turn,
    status: state.status,
    winner: state.winner,
    baseTurnLimit: Math.max(1, normalize_int(state.baseTurnLimit, BASE_TURN_LIMIT, 1)),
    rpsScore: {
      player1: normalize_int(state.rpsScore?.player1, 0, -99999),
      player2: normalize_int(state.rpsScore?.player2, 0, -99999)
    },
    arenaTrapUntilTurn: {
      player1: normalize_int(state.arenaTrapUntilTurn?.player1, 0, 0),
      player2: normalize_int(state.arenaTrapUntilTurn?.player2, 0, 0)
    },
    spikesArmedByTarget: {
      player1: !!state.spikesArmedByTarget?.player1,
      player2: !!state.spikesArmedByTarget?.player2
    },
    players: {
      player1: clone_player(state.players.player1),
      player2: clone_player(state.players.player2)
    },
    pendingSwitch: { ...state.pendingSwitch },
    pendingWish: {
      player1: state.pendingWish?.player1 ?? null,
      player2: state.pendingWish?.player2 ?? null
    },
    tauntUntilTurn: {
      player1: state.tauntUntilTurn?.player1 ?? 0,
      player2: state.tauntUntilTurn?.player2 ?? 0
    },
    leechSeedActiveByTarget: {
      player1: state.leechSeedActiveByTarget?.player1 ?? false,
      player2: state.leechSeedActiveByTarget?.player2 ?? false
    },
    leechSeedSourceByTarget: {
      player1: state.leechSeedSourceByTarget?.player1 ?? null,
      player2: state.leechSeedSourceByTarget?.player2 ?? null
    }
  };
  sync_all_players_shared_hp(cloned);
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
  return action.type === "switch" ? "switch" : "attack";
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
  reason: "switch_vs_switch" | "attack_vs_switch" | "attack_vs_attack",
  context: Record<string, unknown>
): void {
  if (!state.rpsScore) {
    state.rpsScore = empty_rps_score();
  }
  const player1_before = state.rpsScore.player1 ?? 0;
  const player2_before = state.rpsScore.player2 ?? 0;
  state.rpsScore[winner] = (state.rpsScore[winner] ?? 0) + 1;
  state.rpsScore[loser] = (state.rpsScore[loser] ?? 0) - 1;
  log.push({
    type: "mindgame_bonus_ready",
    turn: state.turn,
    summary: `${winner} won mindgame (${reason})`,
    data: {
      winner,
      loser,
      reason,
      ...context
    }
  });
  log.push({
    type: "rps_score_update",
    turn: state.turn,
    summary: `rps score updated (${winner} +1, ${loser} -1)`,
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

function apply_spikes_on_switch(
  state: GameState,
  log: EventLog[],
  slot: PlayerSlot,
  hp_changed?: WeakSet<MonsterState>,
  took_damage_this_turn?: Record<PlayerSlot, boolean>
): void {
  if (!(state.spikesArmedByTarget?.[slot] ?? false)) {
    return;
  }
  state.spikesArmedByTarget[slot] = false;
  const hp_changed_ref = hp_changed ?? new WeakSet<MonsterState>();
  const took_damage_ref = took_damage_this_turn ?? { player1: false, player2: false };
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
    took_damage_ref
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
  took_damage_this_turn: Record<PlayerSlot, boolean>
): void {
  if (!switched_this_turn.player1 || !switched_this_turn.player2) {
    return;
  }
  for (const slot of SLOT_ORDER) {
    const player = state.players[slot];
    if (player.sharedHp <= 0) {
      continue;
    }
    const target_slot = other_slot(slot);
    const target_player = state.players[target_slot];
    const actor = active_monster(player);
    const target = active_monster(target_player);

    if (actor.id === "armoth" && target.type === "atk") {
      const previous_until = state.arenaTrapUntilTurn[target_slot] ?? 0;
      const until_turn = Math.max(previous_until, state.turn + 1);
      state.arenaTrapUntilTurn[target_slot] = until_turn;
      log.push({
        type: "passive_trigger",
        turn: state.turn,
        phase: "switch",
        summary: `${actor.name} passive triggered (Arena Trap vs ATK)`,
        data: { slot, targetSlot: target_slot, source: actor.id, target: target.id, passive: "arena_trap" }
      });
      log.push({
        type: "arena_trap_applied",
        turn: state.turn,
        phase: "switch",
        summary: `${target_slot} is arena trapped until turn ${until_turn}`,
        data: { sourceSlot: slot, targetSlot: target_slot, beforeUntil: previous_until, untilTurn: until_turn }
      });
      continue;
    }

    if (actor.id === "kairus" && target.type === "buf" && target_player.sharedHp > 0) {
      const damage_result = apply_damage_with_endure(
        state,
        log,
        "switch",
        target_slot,
        target,
        10,
        hp_changed,
        took_damage_this_turn
      );
      log.push({
        type: "passive_trigger",
        turn: state.turn,
        phase: "switch",
        summary: `${actor.name} passive Quick Punch dealt ${damage_result.applied} to ${target.name}`,
        data: { slot, targetSlot: target_slot, source: actor.id, target: target.id, passive: "quick_punch", damage: damage_result.applied }
      });
      log.push({
        type: "damage",
        turn: state.turn,
        phase: "switch",
        summary: `${slot} dealt ${damage_result.applied} to ${target.name}`,
        data: {
          slot,
          targetSlot: target_slot,
          source: actor.id,
          target: target.id,
          damage: damage_result.applied,
          before: damage_result.before,
          after: damage_result.after
        }
      });
      continue;
    }

    if (actor.id === "farien" && target.type === "def") {
      const before_hp = player.sharedHp;
      const after_hp = Math.min(player.sharedHpMax, before_hp + 10);
      const healed = Math.max(0, after_hp - before_hp);
      if (healed > 0) {
        sync_player_shared_hp(state, slot, after_hp);
        hp_changed.add(actor);
      }
      log.push({
        type: "passive_trigger",
        turn: state.turn,
        phase: "switch",
        summary: `${actor.name} passive restored ${healed} HP on switch`,
        data: { slot, source: actor.id, target: actor.id, passive: "switch_heal_10", heal: healed, before: before_hp, after: after_hp }
      });
      log.push({
        type: "passive_heal",
        turn: state.turn,
        phase: "switch",
        summary: `${actor.name} healed ${healed} from passive`,
        data: { slot, source: actor.id, target: actor.id, amount: healed, before: before_hp, after: after_hp }
      });
    }
  }
}

function end_match_with_winner(state: GameState, log: EventLog[], winner: PlayerSlot, summary: string, data?: Record<string, unknown>): void {
  state.status = "ended";
  state.winner = winner;
  log.push({
    type: "match_end",
    turn: state.turn,
    summary,
    data: { winner, ...(data ?? {}) }
  });
}

function end_match_draw(state: GameState, log: EventLog[], summary: string, data?: Record<string, unknown>): void {
  state.status = "ended";
  delete state.winner;
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
    });
    return "ended";
  }
  if (p2_hp <= 0 && p1_hp > 0) {
    end_match_with_winner(state, log, "player1", "player1 wins (enemy shared HP reached 0)", {
      player1Hp: p1_hp,
      player2Hp: p2_hp
    });
    return "ended";
  }
  end_match_draw(state, log, "draw (both sides reached 0 HP)", {
    player1Hp: p1_hp,
    player2Hp: p2_hp
  });
  return "ended";
}

function compare_initiative(a: MonsterState, b: MonsterState, stats: Phase["initiative"]): number {
  for (const key of stats) {
    const diff = a[key] - b[key];
    if (diff !== 0) {
      return diff;
    }
  }
  return 0;
}

function find_phase(phaseId: string): Phase | undefined {
  return PHASES.find((phase) => phase.id === phaseId);
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
      monster.endureActiveThisTurn = false;
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
    }
  });
}

function apply_passives(state: GameState, log: EventLog[], hp_changed: WeakSet<MonsterState>): void {
  void state;
  void log;
  void hp_changed;
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

function clear_leech_seed_on_target_switch(state: GameState, log: EventLog[], target_slot: PlayerSlot): void {
  const was_active = state.leechSeedActiveByTarget?.[target_slot] ?? false;
  const source = state.leechSeedSourceByTarget?.[target_slot] ?? null;
  if (!was_active && !source) {
    return;
  }
  state.leechSeedActiveByTarget[target_slot] = false;
  state.leechSeedSourceByTarget[target_slot] = null;
  log.push({
    type: "leech_end",
    turn: state.turn,
    summary: `Leech Life ended on ${target_slot} after switch`,
    data: { slot: target_slot, source }
  });
}

function apply_leech_seed_end_turn(state: GameState, log: EventLog[], hp_changed: WeakSet<MonsterState>): void {
  const active_targets = state.leechSeedActiveByTarget;
  const sources = state.leechSeedSourceByTarget;
  if (!active_targets) {
    return;
  }
  for (const target_slot of SLOT_ORDER) {
    if (!(active_targets[target_slot] ?? false)) {
      continue;
    }
    let source_slot = sources?.[target_slot] ?? null;
    if (!source_slot) {
      // Backward-compatibility for existing states: infer source side from target side.
      source_slot = other_slot(target_slot);
      if (sources) {
        sources[target_slot] = source_slot;
      }
    }
    const target_player = state.players[target_slot];
    const target = active_monster(target_player);
    if (!is_alive(target)) {
      state.leechSeedActiveByTarget[target_slot] = false;
      state.leechSeedSourceByTarget[target_slot] = null;
      continue;
    }

    const target_before = target_player.sharedHp;
    const drained_from_max = mul_div_floor(target_player.sharedHpMax, 1, 8);
    const drained = Math.min(target_before, Math.max(0, drained_from_max));
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
      summary: `${target.name} lost ${drained} HP from Leech Life`,
      data: {
        slot: source_slot,
        targetSlot: target_slot,
        source: source_slot,
        target: target.id,
        damage: drained,
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
          summary: `${receiver.name} healed ${healed} HP from Leech Life`,
          data: {
            slot: source_slot,
            source: source_slot,
            targetSlot: target_slot,
            target: target.id,
            heal: healed,
            before: heal_before,
            after: heal_after
          }
        });
      }
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
      { player1Hp: p1_hp, player2Hp: p2_hp }
    );
    return;
  }

  end_match_draw(state, log, `draw after ${base_turn_limit} turns (equal shared HP)`, {
    player1Hp: p1_hp,
    player2Hp: p2_hp
  });
}

function apply_focus_punch_end_turn(
  state: GameState,
  log: EventLog[],
  hp_changed: WeakSet<MonsterState>,
  focus_punch_pending: Record<PlayerSlot, boolean>,
  took_damage_this_turn: Record<PlayerSlot, boolean>
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
    apply_damage_move(state, log, slot, spec, hp_changed, END_PHASE_ID, took_damage_this_turn);
  }
}

function apply_end_turn_effect(
  state: GameState,
  log: EventLog[],
  hp_changed: WeakSet<MonsterState>,
  effect_id: EndTurnEffectId,
  focus_punch_pending: Record<PlayerSlot, boolean>,
  took_damage_this_turn: Record<PlayerSlot, boolean>
): void {
  if (effect_id === "focus_punch") {
    apply_focus_punch_end_turn(state, log, hp_changed, focus_punch_pending, took_damage_this_turn);
    return;
  }
  if (effect_id === "wish") {
    for (const slot of SLOT_ORDER) {
      apply_pending_wish(state, log, slot, hp_changed);
    }
    return;
  }
  apply_leech_seed_end_turn(state, log, hp_changed);
}

function apply_end_turn_phase(
  state: GameState,
  log: EventLog[],
  hp_changed: WeakSet<MonsterState>,
  focus_punch_pending: Record<PlayerSlot, boolean>,
  took_damage_this_turn: Record<PlayerSlot, boolean>
): MatchProgress {
  for (const effect_id of END_TURN_EFFECT_ORDER) {
    apply_end_turn_effect(state, log, hp_changed, effect_id, focus_punch_pending, took_damage_this_turn);
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
  took_damage_this_turn: Record<PlayerSlot, boolean>
): { before: number; after: number; applied: number } {
  const before = state.players[slot].sharedHp;
  if (before <= 0 || attempted_damage <= 0) {
    return { before, after: before, applied: 0 };
  }

  let after = Math.max(0, before - attempted_damage);
  if (monster.endureActiveThisTurn) {
    const survive_hp = Math.min(before, minimum_endure_hp(monster));
    if (after < survive_hp) {
      const capped_damage = Math.max(0, before - survive_hp);
      after = survive_hp;
      monster.endureActiveThisTurn = false;

      const speed_before = monster.speed;
      monster.speed = Math.max(1, mul_div_round(speed_before, 3, 2));
      monster.endureSpeedBoostActive = true;
      log.push({
        type: "endure_trigger",
        turn: state.turn,
        phase,
        summary: `${monster.name} endured the hit (${before} -> ${after})`,
        data: { slot, target: monster.id, before, after, attemptedDamage: attempted_damage, appliedDamage: capped_damage }
      });
      log.push({
        type: "stat_mod",
        turn: state.turn,
        phase,
        summary: `${monster.name} gained speed from Endure (${speed_before} -> ${monster.speed})`,
        data: { slot, target: monster.id, stat: "speed", multiplier: 1.5, before: speed_before, after: monster.speed }
      });
      log.push({
        type: "move_detail",
        turn: state.turn,
        phase,
        summary: `Endure: immortal trigger (HP floor 1% => ${after}); dmg capped ${attempted_damage} -> ${capped_damage}; SPE x1.5 (${speed_before} -> ${monster.speed})`,
        data: {
          move: "endure",
          slot,
          target: monster.id,
          hpBefore: before,
          hpAfter: after,
          damageAttempted: attempted_damage,
          damageApplied: capped_damage,
          speedBefore: speed_before,
          speedAfter: monster.speed
        }
      });
    }
  }

  const final_after = sync_player_shared_hp(state, slot, after);
  const applied = before - final_after;
  if (applied > 0) {
    hp_changed.add(monster);
    took_damage_this_turn[slot] = true;
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
  took_damage_this_turn: Record<PlayerSlot, boolean>
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

  const effective_attack = attacker.attack;
  const multiplier100 = spec.attackMultiplier100 + (spec.attackMultiplierPerLevel100 ?? 0) * attacker.level;
  const damage_type = spec.damageType ?? "scaled";
  const effective_defense = defender.defense <= 0 ? 1 : defender.defense;
  const level_term = mul_div_floor(2, attacker.level, 5) + 2;
  let raw_damage = 0;
  if (damage_type === "flat") {
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
  const was_blocked = defender.protectActiveThisTurn;
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
    took_damage_this_turn
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
        took_damage_this_turn
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

function apply_move(
  state: GameState,
  log: EventLog[],
  player_slot: PlayerSlot,
  move_id: MoveId,
  move_index: number,
  self_switch_target_index: number | undefined,
  hp_changed: WeakSet<MonsterState>,
  focus_punch_pending: Record<PlayerSlot, boolean>,
  took_damage_this_turn: Record<PlayerSlot, boolean>
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
  if (is_slot_taunted(state, player_slot) && !is_attack_move(spec)) {
    log.push({
      type: "taunt_blocked",
      turn: state.turn,
      phase: spec.phaseId,
      summary: `${player_slot} is taunted and cannot use ${spec.label}`,
      data: {
        slot: player_slot,
        move: spec.id,
        untilTurn: state.tauntUntilTurn?.[player_slot] ?? state.turn
      }
    });
    return;
  }

  if (spec.id === "none") {
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
      summary: `Endure: HP floor this turn = ${floor_hp} (1% do maxHp); on trigger gain SPE x1.5`,
      data: { move: spec.id, slot: player_slot, target: attacker.id, floorHp: floor_hp }
    });
    return;
  }

  if (spec.id === "agility") {
    const before_speed = attacker.speed;
    attacker.speed = Math.max(1, mul_div_round(before_speed, 2, 1));
    attacker.agilityBoostActive = true;
    log.push({
      type: "stat_mod",
      turn: state.turn,
      phase: spec.phaseId,
      summary: `${player_slot} Agility success on ${attacker.name} (SPE ${before_speed} -> ${attacker.speed})`,
      data: {
        slot: player_slot,
        target: attacker.id,
        stat: "speed",
        multiplier: 2,
        before: before_speed,
        after: attacker.speed
      }
    });
    log.push({
      type: "move_detail",
      turn: state.turn,
      phase: spec.phaseId,
      summary: `Agility: user SPE x2 (${before_speed} -> ${attacker.speed})`,
      data: { move: spec.id, slot: player_slot, target: attacker.id, before: before_speed, after: attacker.speed }
    });
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
      summary: `Wish: no turno ${trigger_turn}, no inicio do end_turn, o ativo de ${player_slot} cura +50% do maxHp (clamp no max)`,
      data: { move: spec.id, slot: player_slot, triggerTurn: trigger_turn }
    });
    return;
  }

  if (spec.id === "spikes") {
    const target_slot = other_slot(player_slot);
    state.spikesArmedByTarget[target_slot] = true;
    log.push({
      type: "spikes_set",
      turn: state.turn,
      phase: spec.phaseId,
      summary: `${player_slot} armed Spikes on ${target_slot}`,
      data: { slot: player_slot, targetSlot: target_slot, target: defender.id }
    });
    return;
  }

  if (spec.id === "recover") {
    const before_hp = player.sharedHp;
    const heal_amount = Math.max(0, mul_div_round(player.sharedHpMax, 1, 5));
    const after_hp = Math.min(player.sharedHpMax, before_hp + heal_amount);
    if (after_hp !== before_hp) {
      sync_player_shared_hp(state, player_slot, after_hp);
      hp_changed.add(attacker);
    }
    log.push({
      type: "passive_heal",
      turn: state.turn,
      phase: spec.phaseId,
      summary: `${attacker.name} healed ${Math.max(0, after_hp - before_hp)} with Recover`,
      data: {
        slot: player_slot,
        source: attacker.id,
        target: attacker.id,
        amount: Math.max(0, after_hp - before_hp),
        before: before_hp,
        after: after_hp
      }
    });
    return;
  }

  if (spec.id === "meditate") {
    const before_stage = attacker.attackStage;
    const before_attack = attacker.attack;
    const after_stage = set_attack_stage(attacker, before_stage + 2);
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
    return;
  }

  if (spec.id === "belly_drum") {
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
    const after_stage = set_attack_stage(attacker, STAT_STAGE_MAX);
    const after_attack = attacker.attack;
    attacker.bellyDrumActive = true;

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

  if (spec.id === "bounce_kick") {
    apply_damage_move(state, log, player_slot, spec, hp_changed, spec.phaseId, took_damage_this_turn);
    if (state.players[other_slot(player_slot)].sharedHp <= 0) {
      return;
    }
    if (!Number.isInteger(self_switch_target_index)) {
      log.push({
        type: "move_detail",
        turn: state.turn,
        phase: spec.phaseId,
        summary: "Bounce Kick had no self-switch target and only dealt damage",
        data: { move: spec.id, slot: player_slot }
      });
      return;
    }
    const target_index = Number(self_switch_target_index);
    const switched = apply_switch(state, log, player_slot, target_index, hp_changed, took_damage_this_turn);
    log.push({
      type: "move_detail",
      turn: state.turn,
      phase: spec.phaseId,
      summary: switched
        ? `Bounce Kick switched ${player_slot} to slot ${target_index}`
        : `Bounce Kick failed to switch ${player_slot} to slot ${target_index}`,
      data: { slot: player_slot, move: spec.id, targetIndex: target_index, switched }
    });
    return;
  }

  if (spec.id === "leech_life") {
    const target_slot = other_slot(player_slot);
    state.leechSeedActiveByTarget[target_slot] = true;
    state.leechSeedSourceByTarget[target_slot] = player_slot;
    log.push({
      type: "leech_apply",
      turn: state.turn,
      phase: spec.phaseId,
      summary: `${player_slot} seeded ${defender.name} with Leech Life`,
      data: { slot: player_slot, targetSlot: target_slot, source: player_slot, target: defender.id }
    });
    log.push({
      type: "move_detail",
      turn: state.turn,
      phase: spec.phaseId,
      summary: "Leech Life: target drains 12.5% at end_turn; active on caster side heals same; seed ends when target switches",
      data: { move: spec.id, slot: player_slot, target: defender.id, targetSlot: target_slot }
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
      summary: "Focus Punch: resolves at start of end_turn; fails if user took real damage before executing",
      data: { move: spec.id, slot: player_slot, target: defender.id }
    });
    return;
  }

  if (spec.id === "screech") {
    const before_defense = defender.defense;
    const after_defense = Math.max(1, mul_div_floor(before_defense, 1, 2));
    defender.defense = after_defense;
    defender.screechDebuffActive = true;
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
    return;
  }

  if (spec.id === "taunt") {
    const target_slot = other_slot(player_slot);
    const before_until = state.tauntUntilTurn?.[target_slot] ?? 0;
    const until_turn = Math.max(before_until, state.turn + 1);
    state.tauntUntilTurn[target_slot] = until_turn;
    log.push({
      type: "taunt",
      turn: state.turn,
      phase: spec.phaseId,
      summary: `${player_slot} used Taunt on ${defender.name}`,
      data: { slot: player_slot, target: defender.id, targetSlot: target_slot, beforeUntil: before_until, untilTurn: until_turn }
    });
    log.push({
      type: "move_detail",
      turn: state.turn,
      phase: spec.phaseId,
      summary: `Taunt: ${target_slot} non-attack actions blocked on turns ${state.turn} and ${state.turn + 1}`,
      data: { move: spec.id, slot: player_slot, target: defender.id, targetSlot: target_slot, untilTurn: until_turn }
    });
    return;
  }

  if (spec.id === "pain_split") {
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
    return;
  }

  apply_damage_move(state, log, player_slot, spec, hp_changed, spec.phaseId, took_damage_this_turn);
}

function apply_switch(
  state: GameState,
  log: EventLog[],
  player_slot: PlayerSlot,
  targetIndex: number,
  hp_changed?: WeakSet<MonsterState>,
  took_damage_this_turn?: Record<PlayerSlot, boolean>
): boolean {
  const player = state.players[player_slot];
  const activeIndex = player.activeIndex;
  if (targetIndex < 0 || targetIndex >= player.team.length) {
    log.push({
      type: "switch_invalid",
      turn: state.turn,
      summary: `${player_slot} invalid switch`,
      data: { slot: player_slot, targetIndex }
    });
    return false;
  }
  if (targetIndex === activeIndex) {
    log.push({
      type: "switch_invalid",
      turn: state.turn,
      summary: `${player_slot} already active`,
      data: { slot: player_slot, targetIndex }
    });
    return false;
  }
  if (!is_alive(player.team[targetIndex])) {
    log.push({
      type: "switch_invalid",
      turn: state.turn,
      summary: `${player_slot} cannot switch to fainted`,
      data: { slot: player_slot, targetIndex }
    });
    return false;
  }
  const outgoing = player.team[activeIndex];
  outgoing.attack = outgoing.baseAttack;
  outgoing.attackStage = 0;
  outgoing.defense = outgoing.baseDefense;
  outgoing.speed = outgoing.baseSpeed;
  outgoing.agilityBoostActive = false;
  outgoing.endureSpeedBoostActive = false;
  outgoing.bellyDrumActive = false;
  outgoing.screechDebuffActive = false;
  clear_leech_seed_on_target_switch(state, log, player_slot);
  outgoing.choiceBandLockedMoveIndex = null;
  player.activeIndex = targetIndex;
  sync_player_shared_hp(state, player_slot, player.sharedHp);
  apply_spikes_on_switch(state, log, player_slot, hp_changed, took_damage_this_turn);
  log.push({
    type: "switch",
    turn: state.turn,
    summary: `${player_slot} switched to ${player.team[targetIndex].name}`,
    data: { slot: player_slot, from: activeIndex, to: targetIndex }
  });
  return true;
}

function build_actions(intents: Record<PlayerSlot, PlayerIntent | null>, state: GameState): Action[] {
  const actions: Action[] = [];
  for (const slot of SLOT_ORDER) {
    const intent = intents[slot];
    if (!intent) continue;
    if (intent.action === "switch") {
      actions.push({ player: slot, type: "switch", phase: "switch", targetIndex: intent.targetIndex });
    } else {
      const player = state.players[slot];
      const active = active_monster(player);
      const moveId = active.chosenMoves[intent.moveIndex] ?? "none";
      const spec = move_spec(moveId);
      actions.push({
        player: slot,
        type: "move",
        phase: spec.phaseId,
        moveId,
        moveIndex: intent.moveIndex,
        selfSwitchTargetIndex: intent.selfSwitchTargetIndex
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
        level,
        baseAttack: final_stats.atk,
        baseDefense: final_stats.def,
        baseSpeed: final_stats.spe,
        attack: final_stats.atk,
        attackStage: 0,
        defense: final_stats.def,
        speed: final_stats.spe,
        agilityBoostActive: false,
        endureSpeedBoostActive: false,
        bellyDrumActive: false,
        screechDebuffActive: false,
        possibleMoves: monster.moves.slice(),
        possiblePassives: [monster.passive],
        chosenMoves: monster.moves.slice(0, 3),
        chosenPassive: monster.passive,
        protectActiveThisTurn: false,
        endureActiveThisTurn: false,
        choiceBandLockedMoveIndex: null,
        protectCooldownTurns: 0,
        endureCooldownTurns: 0
      };
    });
    return {
      slot,
      name: names[slot],
      sharedHp: shared_hp,
      sharedHpMax: shared_hp,
      team,
      activeIndex: Math.min(Math.max(selection.activeIndex, 0), team.length - 1)
    };
  };

  const initial_state: GameState = {
    turn: 0,
    status: "setup",
    baseTurnLimit: BASE_TURN_LIMIT,
    rpsScore: empty_rps_score(),
    arenaTrapUntilTurn: empty_arena_trap_until_turn(),
    spikesArmedByTarget: empty_spikes_armed_by_target(),
    players: {
      player1: build_player("player1"),
      player2: build_player("player2")
    },
    pendingSwitch: empty_pending(),
    pendingWish: empty_pending_wish(),
    tauntUntilTurn: empty_taunt_until_turn(),
    leechSeedActiveByTarget: empty_leech_seed_active(),
    leechSeedSourceByTarget: empty_leech_seed_sources()
  };
  sync_all_players_shared_hp(initial_state);
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
  const switched_this_turn: Record<PlayerSlot, boolean> = { player1: false, player2: false };
  sync_all_players_shared_hp(next);
  next.baseTurnLimit = Math.max(1, normalize_int(next.baseTurnLimit, BASE_TURN_LIMIT, 1));

  if (next.status !== "running") {
    return { state: next, log };
  }

  if (!next.pendingSwitch) {
    next.pendingSwitch = empty_pending();
  }
  if (!next.pendingWish) {
    next.pendingWish = empty_pending_wish();
  }
  if (!next.tauntUntilTurn) {
    next.tauntUntilTurn = empty_taunt_until_turn();
  }
  if (!next.leechSeedActiveByTarget) {
    next.leechSeedActiveByTarget = empty_leech_seed_active();
  }
  if (!next.leechSeedSourceByTarget) {
    next.leechSeedSourceByTarget = empty_leech_seed_sources();
  }
  if (!next.rpsScore) {
    next.rpsScore = empty_rps_score();
  }
  if (!next.arenaTrapUntilTurn) {
    next.arenaTrapUntilTurn = empty_arena_trap_until_turn();
  }
  if (!next.spikesArmedByTarget) {
    next.spikesArmedByTarget = empty_spikes_armed_by_target();
  }
  next.pendingSwitch = empty_pending();

  const actions = build_actions(intents, next);
  reset_protect_flags(next);
  apply_mindgame_bonus_event(next, log, actions);
  let progress = check_zero_hp_match_result(next, log);
  const phases = [...PHASES].sort((a, b) => a.order - b.order);

  for (const phase of phases) {
    if (progress !== "continue") {
      break;
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
        const trapped_until = next.arenaTrapUntilTurn?.[action.player] ?? 0;
        if (is_slot_arena_trapped(next, action.player)) {
          log.push({
            type: "switch_blocked",
            turn: next.turn,
            phase: phase.id,
            summary: `${action.player} cannot switch (arena trapped until turn ${trapped_until})`,
            data: { slot: action.player, targetIndex: action.targetIndex, untilTurn: trapped_until }
          });
        } else if (is_slot_taunted(next, action.player)) {
          log.push({
            type: "taunt_blocked",
            turn: next.turn,
            phase: phase.id,
            summary: `${action.player} is taunted and cannot switch`,
            data: { slot: action.player, action: "switch", untilTurn: next.tauntUntilTurn[action.player] }
          });
        } else {
          const switched = apply_switch(
            next,
            log,
            action.player,
            action.targetIndex,
            hp_changed_this_turn,
            took_damage_this_turn
          );
          if (switched) {
            switched_this_turn[action.player] = true;
          }
        }
      } else {
        apply_move(
          next,
          log,
          action.player,
          action.moveId,
          action.moveIndex,
          action.selfSwitchTargetIndex,
          hp_changed_this_turn,
          focus_punch_pending,
          took_damage_this_turn
        );
      }
      progress = check_zero_hp_match_result(next, log);
      if (progress !== "continue") {
        break;
      }
    }
    if (phase.id === "switch" && progress === "continue") {
      apply_simultaneous_switch_passives(next, log, switched_this_turn, hp_changed_this_turn, took_damage_this_turn);
      progress = check_zero_hp_match_result(next, log);
    }
  }

  if (progress === "continue") {
    progress = apply_end_turn_phase(next, log, hp_changed_this_turn, focus_punch_pending, took_damage_this_turn);
  }
  decrement_cooldowns(next);
  // Clear guard flags after the turn resolves (so next turn starts unprotected/not-enduring).
  reset_protect_flags(next);

  if (next.status === "running") {
    maybe_end_match_by_turn_limit(next, log);
  }

  return { state: next, log };
}

export function apply_forced_switch(
  state: GameState,
  slot: PlayerSlot,
  targetIndex: number
): { state: GameState; log: EventLog[]; error?: string } {
  const next = clone_state(state);
  const log: EventLog[] = [];
  const player = next.players[slot];
  if (!next.pendingSwitch[slot]) {
    return { state: next, log, error: "no pending switch" };
  }
  if (targetIndex < 0 || targetIndex >= player.team.length) {
    return { state: next, log, error: "invalid switch target" };
  }
  if (targetIndex === player.activeIndex) {
    return { state: next, log, error: "already active" };
  }
  if (!is_alive(player.team[targetIndex])) {
    return { state: next, log, error: "target fainted" };
  }
  const from = player.activeIndex;
  const outgoing = player.team[from];
  outgoing.attack = outgoing.baseAttack;
  outgoing.attackStage = 0;
  outgoing.defense = outgoing.baseDefense;
  outgoing.speed = outgoing.baseSpeed;
  outgoing.agilityBoostActive = false;
  outgoing.endureSpeedBoostActive = false;
  outgoing.bellyDrumActive = false;
  outgoing.screechDebuffActive = false;
  clear_leech_seed_on_target_switch(next, log, slot);
  outgoing.choiceBandLockedMoveIndex = null;
  player.activeIndex = targetIndex;
  sync_player_shared_hp(next, slot, player.sharedHp);
  apply_spikes_on_switch(next, log, slot);
  next.pendingSwitch[slot] = false;
  log.push({
    type: "forced_switch",
    turn: next.turn,
    summary: `${slot} switched to ${player.team[targetIndex].name}`,
    data: { slot, from, to: targetIndex }
  });
  return { state: next, log };
}

export function validate_intent(state: GameState, slot: PlayerSlot, intent: PlayerIntent): string | null {
  const player = state.players[slot];
  if (!player) {
    return "unknown player";
  }
  if (state.pendingSwitch[slot]) {
    return "pending switch";
  }
  const active = active_monster(player);
  const taunted = is_slot_taunted(state, slot);
  if (intent.action === "switch") {
    if (is_slot_arena_trapped(state, slot)) {
      return "arena trapped";
    }
    if (taunted) {
      return "taunted: must use attack";
    }
    if (intent.targetIndex < 0 || intent.targetIndex >= player.team.length) {
      return "invalid switch target";
    }
    if (intent.targetIndex === player.activeIndex) {
      return "already active";
    }
    if (!is_alive(player.team[intent.targetIndex])) {
      return "target fainted";
    }
    return null;
  }

  if (intent.moveIndex < 0 || intent.moveIndex >= active.chosenMoves.length) {
    return "invalid move index";
  }

  const moveId = active.chosenMoves[intent.moveIndex] ?? "none";
  const guard_cooldown = Math.max(active.protectCooldownTurns, active.endureCooldownTurns);
  if (taunted && !is_attack_move(move_spec(moveId))) {
    return "taunted: must use attack";
  }
  if (moveId === "protect" && guard_cooldown > 0) {
    return "protect on cooldown";
  }
  if (moveId === "endure" && guard_cooldown > 0) {
    return "endure on cooldown";
  }
  if (moveId === "bounce_kick") {
    if (is_slot_arena_trapped(state, slot)) {
      return "arena trapped";
    }
    if (!Number.isInteger(intent.selfSwitchTargetIndex)) {
      return "bounce kick requires switch target";
    }
    const target_index = Number(intent.selfSwitchTargetIndex);
    if (target_index < 0 || target_index >= player.team.length) {
      return "invalid bounce kick switch target";
    }
    if (target_index === player.activeIndex) {
      return "bounce kick target already active";
    }
    if (!is_alive(player.team[target_index])) {
      return "bounce kick target fainted";
    }
  }

  return null;
}
