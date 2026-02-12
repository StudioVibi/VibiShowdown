import type {
  EVSpread,
  EventLog,
  GameState,
  MonsterState,
  MoveId,
  PlayerIntent,
  PlayerSlot,
  PlayerState,
  TeamSelection
} from "./shared.ts";
import { MONSTER_BY_ID } from "./game_default/pokemon.ts";
import { move_spec } from "./game_default/moves.ts";
import { apply_passive_turn_effect, passive_spec } from "./game_default/passives.ts";
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
const END_TURN_EFFECT_ORDER = ["focus_punch", "wish", "leftovers", "leech_life"] as const;
type EndTurnEffectId = (typeof END_TURN_EFFECT_ORDER)[number];

const TAUNT_BLOCKED_MOVE_IDS = new Set([
  "none",
  "agility",
  "wish",
  "belly_drum",
  "screech",
  "taunt",
  "pain_split",
  "leech_life"
]);

type Action =
  | { player: PlayerSlot; type: "switch"; phase: string; targetIndex: number }
  | { player: PlayerSlot; type: "move"; phase: string; moveId: MoveId; moveIndex: number };

const INITIATIVE_WITHOUT_SPEED: Phase["initiative"] = ["attack", "hp", "defense"];

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
  return {
    id: monster.id,
    name: monster.name,
    hp: monster.hp,
    maxHp: monster.maxHp,
    level: monster.level,
    attack: monster.attack,
    defense: monster.defense,
    spAttack: monster.spAttack,
    spDefense: monster.spDefense,
    speed: monster.speed,
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

function empty_pending_wish(): Record<PlayerSlot, number | null> {
  return { player1: null, player2: null };
}

function empty_taunt_until_turn(): Record<PlayerSlot, number> {
  return { player1: 0, player2: 0 };
}

function empty_leech_seed_active(): Record<PlayerSlot, boolean> {
  return { player1: false, player2: false };
}

function empty_leech_seed_sources(): Record<PlayerSlot, PlayerSlot | null> {
  return { player1: null, player2: null };
}

function is_slot_taunted(state: GameState, slot: PlayerSlot): boolean {
  return (state.tauntUntilTurn?.[slot] ?? 0) >= state.turn;
}

function is_attack_move(spec: { id: string; phaseId: string }): boolean {
  if (spec.phaseId !== "attack_01") {
    return false;
  }
  return !TAUNT_BLOCKED_MOVE_IDS.has(spec.id);
}

function clone_player(player: PlayerState): PlayerState {
  return {
    slot: player.slot,
    name: player.name,
    team: player.team.map(clone_monster),
    activeIndex: player.activeIndex
  };
}

export function clone_state(state: GameState): GameState {
  return {
    turn: state.turn,
    status: state.status,
    winner: state.winner,
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
}

function active_monster(player: PlayerState): MonsterState {
  return player.team[player.activeIndex];
}

function other_slot(slot: PlayerSlot): PlayerSlot {
  return slot === "player1" ? "player2" : "player1";
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
  return monster.hp > 0;
}

function any_alive(player: PlayerState): boolean {
  return player.team.some((monster) => monster.hp > 0);
}

function first_alive_bench(player: PlayerState): number | null {
  for (let i = 0; i < player.team.length; i++) {
    if (i === player.activeIndex) continue;
    if (player.team[i].hp > 0) {
      return i;
    }
  }
  return null;
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
  for_each_player(state, (player) => {
    const active = active_monster(player);
    if (!is_alive(active)) return;
    apply_passive_turn_effect(active.chosenPassive, {
      slot: player.slot,
      monster: active,
      turn: state.turn,
      phase: END_PHASE_ID,
      log,
      hp_changed
    });
  });
}

function apply_pending_wish(state: GameState, log: EventLog[], slot: PlayerSlot, hp_changed: WeakSet<MonsterState>): void {
  if ((state.pendingWish?.[slot] ?? null) !== state.turn) {
    return;
  }

  const player = state.players[slot];
  const target = active_monster(player);
  const before_hp = target.hp;
  const wish_heal = Math.max(0, mul_div_round(target.maxHp, 1, 2));
  const after_hp = Math.min(target.maxHp, Math.max(0, before_hp + wish_heal));
  state.pendingWish[slot] = null;

  if (after_hp !== before_hp) {
    target.hp = after_hp;
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

    const target_before = target.hp;
    const drained_from_max = mul_div_floor(target.maxHp, 1, 8);
    const drained = Math.min(target_before, Math.max(0, drained_from_max));
    const target_after = target_before - drained;
    if (drained <= 0) {
      continue;
    }
    target.hp = target_after;
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
      const heal_before = receiver.hp;
      const heal_after = Math.min(receiver.maxHp, receiver.hp + drained);
      const healed = Math.max(0, heal_after - heal_before);
      if (healed > 0) {
        receiver.hp = heal_after;
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

    if (target_before > 0 && target_after === 0) {
      log.push({
        type: "faint",
        turn: state.turn,
        phase: END_PHASE_ID,
        summary: `${target.name} fainted`,
        data: { slot: target_slot, target: target.id }
      });
    }
    handle_faint(state, log, target_slot);
  }
}

function check_match_end(state: GameState, log: EventLog[]): boolean {
  if (!any_alive(state.players.player1)) {
    state.status = "ended";
    state.winner = "player2";
    log.push({
      type: "match_end",
      turn: state.turn,
      summary: "player2 wins (all monsters down)",
      data: { winner: "player2" }
    });
    return true;
  }
  if (!any_alive(state.players.player2)) {
    state.status = "ended";
    state.winner = "player1";
    log.push({
      type: "match_end",
      turn: state.turn,
      summary: "player1 wins (all monsters down)",
      data: { winner: "player1" }
    });
    return true;
  }
  return false;
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
  if (effect_id === "leftovers") {
    apply_passives(state, log, hp_changed);
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
): void {
  for (const effect_id of END_TURN_EFFECT_ORDER) {
    if (state.status === "ended") {
      break;
    }
    apply_end_turn_effect(state, log, hp_changed, effect_id, focus_punch_pending, took_damage_this_turn);
    if (check_match_end(state, log)) {
      break;
    }
  }
}

function handle_faint(state: GameState, log: EventLog[], slot: PlayerSlot): void {
  const player = state.players[slot];
  if (is_alive(active_monster(player))) {
    return;
  }
  const next_index = first_alive_bench(player);
  if (next_index === null) {
    return;
  }
  state.pendingSwitch[slot] = true;
  log.push({
    type: "forced_switch_pending",
    turn: state.turn,
    summary: `${slot} must choose a replacement`,
    data: { slot }
  });
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
  const before = monster.hp;
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

  monster.hp = after;
  const applied = before - after;
  if (applied > 0) {
    hp_changed.add(monster);
    took_damage_this_turn[slot] = true;
  }
  return { before, after, applied };
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

  const passive = passive_spec(attacker.chosenPassive);
  const choice_band_active = passive.id === "choice_band";
  const effective_attack = choice_band_active ? Math.max(0, mul_div_round(attacker.attack, 3, 2)) : attacker.attack;
  const multiplier100 = spec.attackMultiplier100 + (spec.attackMultiplierPerLevel100 ?? 0) * attacker.level;
  const damage_type = spec.damageType ?? "scaled";
  const effective_defense = defender.defense <= 0 ? 1 : defender.defense;
  let raw_damage = 0;
  if (damage_type === "flat") {
    raw_damage = spec.flatDamage ?? 0;
  } else if (damage_type === "true") {
    raw_damage = mul_div_round(effective_attack, multiplier100, 100);
  } else {
    raw_damage = mul_div_round(effective_attack, multiplier100, effective_defense);
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

  if (defender_result.before > 0 && defender_result.after === 0) {
    log.push({
      type: "faint",
      turn: state.turn,
      phase: phase_id,
      summary: `${defender.name} fainted`,
      data: { slot: opponent_slot, target: defender.id }
    });
  }

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
      if (recoil_result.before > 0 && recoil_result.after === 0) {
        log.push({
          type: "faint",
          turn: state.turn,
          phase: phase_id,
          summary: `${attacker.name} fainted`,
          data: { slot: player_slot, target: attacker.id }
        });
      }
    }
  }

  const choice_band_detail =
    choice_band_active && damage_type !== "flat"
      ? `; Choice Band ATK boost: ${attacker.attack} -> ${effective_attack}`
      : "";

  if (spec.id === "return") {
    const detail = `Return: dmg = round(atk * (72 + 4*lvl) / def) = round(${effective_attack} * ${multiplier100} / ${effective_defense}) = ${raw_damage}; final=${final_damage}${
      was_blocked ? " (blocked by Protect)" : ""
    }${choice_band_detail}`;
    log.push({
      type: "move_detail",
      turn: state.turn,
      phase: phase_id,
      summary: detail,
      data: { move: spec.id, damage: final_damage, blocked: was_blocked }
    });
  } else if (spec.id === "double_edge") {
    const detail = `Double-Edge: dmg = round(atk*120/def) = round(${effective_attack}*120/${effective_defense}) = ${raw_damage}; final=${final_damage}${
      was_blocked ? " (blocked by Protect)" : ""
    }; recoil = round(final/3) = ${recoil_damage} (${recoil_before} -> ${attacker.hp})${choice_band_detail}`;
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
    const detail = `Quick Attack: dmg = round(atk*66/def) = round(${effective_attack}*66/${effective_defense}) = ${raw_damage}; final=${final_damage}${
      was_blocked ? " (blocked by Protect)" : ""
    }; speed check ignored${choice_band_detail}`;
    log.push({
      type: "move_detail",
      turn: state.turn,
      phase: phase_id,
      summary: detail,
      data: { move: spec.id, damage: final_damage, blocked: was_blocked }
    });
  } else if (spec.id === "focus_punch") {
    const detail = `Focus Punch: dmg = round(atk*150/def) = round(${effective_attack}*150/${effective_defense}) = ${raw_damage}; final=${final_damage}${
      was_blocked ? " (blocked by Protect)" : ""
    }${choice_band_detail}`;
    log.push({
      type: "move_detail",
      turn: state.turn,
      phase: phase_id,
      summary: detail,
      data: { move: spec.id, damage: final_damage, blocked: was_blocked }
    });
  }

  handle_faint(state, log, opponent_slot);
  if (recoil_num > 0 && recoil_den > 0) {
    handle_faint(state, log, player_slot);
  }
}

function apply_move(
  state: GameState,
  log: EventLog[],
  player_slot: PlayerSlot,
  move_id: MoveId,
  move_index: number,
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

  const passive = passive_spec(attacker.chosenPassive);
  const choice_band_active = passive.id === "choice_band";

  if (choice_band_active && attacker.choiceBandLockedMoveIndex === null && spec.id !== "none") {
    attacker.choiceBandLockedMoveIndex = move_index;
    const locked_move_id = attacker.chosenMoves[move_index] ?? "none";
    log.push({
      type: "choice_band_lock",
      turn: state.turn,
      phase: spec.phaseId,
      summary: `${attacker.name} is locked into ${locked_move_id} (slot ${move_index + 1})`,
      data: { slot: player_slot, moveIndex: move_index, move: locked_move_id, passive: passive.id }
    });
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

  if (spec.id === "belly_drum") {
    const before_hp = attacker.hp;
    const before_attack = attacker.attack;
    const hp_cost = Math.max(1, mul_div_floor(attacker.maxHp, 1, 2));
    const after_hp = Math.max(1, before_hp - hp_cost);
    const after_attack = Math.max(0, mul_div_round(before_attack, 2, 1));
    attacker.hp = after_hp;
    attacker.attack = after_attack;

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
        multiplier: 2,
        before: before_attack,
        after: after_attack
      }
    });
    log.push({
      type: "move_detail",
      turn: state.turn,
      phase: spec.phaseId,
      summary: `Belly Drum: user paga 50% do maxHp (${before_hp} -> ${after_hp}); ATK x2 (${before_attack} -> ${after_attack})`,
      data: {
        move: spec.id,
        slot: player_slot,
        target: attacker.id,
        hpBefore: before_hp,
        hpAfter: after_hp,
        hpCost: hp_cost,
        hpCostBasedOn: "maxHp",
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
    const before_user_hp = attacker.hp;
    const before_target_hp = defender.hp;
    const shared_hp = Math.max(1, mul_div_floor(before_user_hp + before_target_hp, 1, 2));
    const after_user_hp = Math.min(attacker.maxHp, shared_hp);
    const after_target_hp = Math.min(defender.maxHp, shared_hp);

    attacker.hp = after_user_hp;
    defender.hp = after_target_hp;
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

function apply_switch(state: GameState, log: EventLog[], player_slot: PlayerSlot, targetIndex: number): void {
  const player = state.players[player_slot];
  const activeIndex = player.activeIndex;
  if (targetIndex < 0 || targetIndex >= player.team.length) {
    log.push({
      type: "switch_invalid",
      turn: state.turn,
      summary: `${player_slot} invalid switch`,
      data: { slot: player_slot, targetIndex }
    });
    return;
  }
  if (targetIndex === activeIndex) {
    log.push({
      type: "switch_invalid",
      turn: state.turn,
      summary: `${player_slot} already active`,
      data: { slot: player_slot, targetIndex }
    });
    return;
  }
  if (!is_alive(player.team[targetIndex])) {
    log.push({
      type: "switch_invalid",
      turn: state.turn,
      summary: `${player_slot} cannot switch to fainted`,
      data: { slot: player_slot, targetIndex }
    });
    return;
  }
  clear_leech_seed_on_target_switch(state, log, player_slot);
  player.team[activeIndex].choiceBandLockedMoveIndex = null;
  player.activeIndex = targetIndex;
  log.push({
    type: "switch",
    turn: state.turn,
    summary: `${player_slot} switched to ${player.team[targetIndex].name}`,
    data: { slot: player_slot, from: activeIndex, to: targetIndex }
  });
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
        moveIndex: intent.moveIndex
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
      spa: read_ev_component(source, "spa"),
      spd: read_ev_component(source, "spd"),
      spe: read_ev_component(source, "spe")
    };
  };

  const build_player = (slot: PlayerSlot): PlayerState => {
    const selection = teams[slot];
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
          spa: spec.stats.spAttack,
          spd: spec.stats.spDefense,
          spe: spec.stats.speed
        },
        level,
        ev
      );
      return {
        id: monster.id,
        name: monster.id,
        hp: final_stats.hpMax,
        maxHp: final_stats.hpMax,
        level,
        attack: final_stats.atk,
        defense: final_stats.def,
        spAttack: final_stats.spa,
        spDefense: final_stats.spd,
        speed: final_stats.spe,
        possibleMoves: monster.moves.slice(),
        possiblePassives: [monster.passive],
        chosenMoves: monster.moves.slice(0, 4),
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
      team,
      activeIndex: Math.min(Math.max(selection.activeIndex, 0), team.length - 1)
    };
  };

  return {
    turn: 0,
    status: "setup",
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

  reset_protect_flags(next);
  const actions = build_actions(intents, next);
  const phases = [...PHASES].sort((a, b) => a.order - b.order);
  let match_ended_in_main_phases = false;

  for (const phase of phases) {
    const phase_actions = actions.filter((action) => action.phase === phase.id);
    if (phase_actions.length === 0) {
      continue;
    }

    if (phase_actions.length >= 2) {
      phase_actions.sort((a, b) => compare_actions_for_phase(next, phase, a, b));
      const first = phase_actions[0];
      const second = phase_actions[1];
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
        if (is_slot_taunted(next, action.player)) {
          log.push({
            type: "taunt_blocked",
            turn: next.turn,
            phase: phase.id,
            summary: `${action.player} is taunted and cannot switch`,
            data: { slot: action.player, action: "switch", untilTurn: next.tauntUntilTurn[action.player] }
          });
          continue;
        }
        apply_switch(next, log, action.player, action.targetIndex);
      } else {
        apply_move(
          next,
          log,
          action.player,
          action.moveId,
          action.moveIndex,
          hp_changed_this_turn,
          focus_punch_pending,
          took_damage_this_turn
        );
      }

      if (check_match_end(next, log)) {
        match_ended_in_main_phases = true;
        break;
      }
    }

    if (match_ended_in_main_phases) {
      break;
    }
  }

  if (!match_ended_in_main_phases) {
    apply_end_turn_phase(next, log, hp_changed_this_turn, focus_punch_pending, took_damage_this_turn);
  }
  decrement_cooldowns(next);
  // Clear guard flags after the turn resolves (so next turn starts unprotected/not-enduring).
  reset_protect_flags(next);

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
  clear_leech_seed_on_target_switch(next, log, slot);
  player.team[from].choiceBandLockedMoveIndex = null;
  player.activeIndex = targetIndex;
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

  const passive = passive_spec(active.chosenPassive);
  if (
    passive.id === "choice_band" &&
    active.choiceBandLockedMoveIndex !== null &&
    intent.moveIndex !== active.choiceBandLockedMoveIndex
  ) {
    return "choice band locked";
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

  return null;
}
