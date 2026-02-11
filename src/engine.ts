import type {
  EventLog,
  GameState,
  MonsterState,
  MoveId,
  PlayerIntent,
  PlayerSlot,
  PlayerState,
  Stats,
  TeamSelection
} from "./shared.ts";
import { move_spec } from "./game_default/moves.ts";
import { apply_passive_turn_effect, passive_spec } from "./game_default/passives.ts";
import { mul_div_ceil, mul_div_floor, mul_div_round, normalize_int } from "./int_math.ts";

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

type Action =
  | { player: PlayerSlot; type: "switch"; phase: string; targetIndex: number }
  | { player: PlayerSlot; type: "move"; phase: string; moveId: MoveId; moveIndex: number }
  | { player: PlayerSlot; type: "wish"; phase: string };

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
  if (action.type === "wish") return 0;
  if (action.type === "move") return 1;
  return 2;
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
    speed: monster.speed,
    possibleMoves: monster.possibleMoves.slice(),
    possiblePassives: monster.possiblePassives.slice(),
    chosenMoves: monster.chosenMoves.slice(),
    chosenPassive: monster.chosenPassive,
    protectActiveThisTurn: monster.protectActiveThisTurn,
    endureActiveThisTurn: monster.endureActiveThisTurn,
    choiceBandLockedMoveIndex: monster.choiceBandLockedMoveIndex,
    protectCooldownTurns: monster.protectCooldownTurns
  };
}

function empty_pending(): Record<PlayerSlot, boolean> {
  return { player1: false, player2: false };
}

function empty_pending_wish(): Record<PlayerSlot, number | null> {
  return { player1: null, player2: null };
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
  fn(state.players.player1);
  fn(state.players.player2);
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
      if (monster.protectCooldownTurns > 0) {
        monster.protectCooldownTurns -= 1;
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
  const after_hp = Math.min(target.maxHp, Math.max(0, mul_div_round(before_hp, 3, 2)));
  state.pendingWish[slot] = null;

  if (after_hp !== before_hp) {
    target.hp = after_hp;
    hp_changed.add(target);
    log.push({
      type: "wish_heal",
      turn: state.turn,
      phase: "attack_01",
      summary: `${target.name} recebeu Wish (${before_hp} -> ${after_hp})`,
      data: { slot, target: target.id, before: before_hp, after: after_hp }
    });
  } else {
    log.push({
      type: "wish_heal",
      turn: state.turn,
      phase: "attack_01",
      summary: `${target.name} recebeu Wish (sem efeito: ${before_hp} -> ${after_hp})`,
      data: { slot, target: target.id, before: before_hp, after: after_hp }
    });
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
  hp_changed: WeakSet<MonsterState>
): { before: number; after: number; applied: number } {
  const before = monster.hp;
  if (before <= 0 || attempted_damage <= 0) {
    return { before, after: before, applied: 0 };
  }

  let after = Math.max(0, before - attempted_damage);
  if (after === 0 && monster.endureActiveThisTurn) {
    const survive_hp = Math.min(before, minimum_endure_hp(monster));
    after = survive_hp;
    monster.endureActiveThisTurn = false;

    const speed_before = monster.speed;
    monster.speed = Math.max(1, mul_div_round(speed_before, 3, 2));
    log.push({
      type: "endure_trigger",
      turn: state.turn,
      phase,
      summary: `${monster.name} endured the hit (${before} -> ${after})`,
      data: { slot, target: monster.id, before, after }
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
      summary: `Endure: immortal trigger (HP floor 1% => ${after}); SPE x1.5 (${speed_before} -> ${monster.speed})`,
      data: {
        move: "endure",
        slot,
        target: monster.id,
        hpBefore: before,
        hpAfter: after,
        speedBefore: speed_before,
        speedAfter: monster.speed
      }
    });
  }

  monster.hp = after;
  if (after !== before) {
    hp_changed.add(monster);
  }
  return { before, after, applied: before - after };
}

function apply_move(
  state: GameState,
  log: EventLog[],
  player_slot: PlayerSlot,
  move_id: MoveId,
  move_index: number,
  hp_changed: WeakSet<MonsterState>
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
    if (attacker.protectCooldownTurns > 0) {
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
    attacker.endureActiveThisTurn = true;
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
      summary: "Endure: cannot be reduced below 1% HP this turn; on trigger gain SPE x1.5",
      data: { move: spec.id, slot: player_slot, target: attacker.id }
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
      summary: `Wish: no turno ${trigger_turn}, o ativo de ${player_slot} recebe HP x1.5 (max ${attacker.maxHp})`,
      data: { move: spec.id, slot: player_slot, triggerTurn: trigger_turn }
    });
    return;
  }

  if (spec.id === "bells_drum") {
    const before_hp = attacker.hp;
    const before_attack = attacker.attack;
    const after_hp = Math.max(1, mul_div_floor(before_hp, 1, 2));
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
        summary: `${attacker.name} paid ${hp_spent} HP for Bells Drum`,
        data: { slot: player_slot, damage: hp_spent, target: attacker.id, move: spec.id }
      });
    }

    log.push({
      type: "stat_mod",
      turn: state.turn,
      phase: spec.phaseId,
      summary: `${player_slot} used Bells Drum on ${attacker.name} (ATK ${before_attack} -> ${after_attack})`,
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
      summary: `Bells Drum: user HP x0.5 (${before_hp} -> ${after_hp}); ATK x2 (${before_attack} -> ${after_attack})`,
      data: {
        move: spec.id,
        slot: player_slot,
        target: attacker.id,
        hpBefore: before_hp,
        hpAfter: after_hp,
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
      phase: spec.phaseId,
      summary: `${defender.name} blocked the attack`,
      data: { slot: other_slot(player_slot) }
    });
  }

  const defender_result = apply_damage_with_endure(
    state,
    log,
    spec.phaseId,
    other_slot(player_slot),
    defender,
    damage,
    hp_changed
  );
  const final_damage = defender_result.applied;
  log.push({
    type: "damage",
    turn: state.turn,
    phase: spec.phaseId,
    summary: `${player_slot} dealt ${final_damage} to ${defender.name}`,
    data: { slot: player_slot, damage: final_damage, target: defender.id }
  });

  if (defender_result.before > 0 && defender_result.after === 0) {
    log.push({
      type: "faint",
      turn: state.turn,
      phase: spec.phaseId,
      summary: `${defender.name} fainted`,
      data: { slot: other_slot(player_slot), target: defender.id }
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
        spec.phaseId,
        player_slot,
        attacker,
        recoil_damage,
        hp_changed
      );
      recoil_before = recoil_result.before;
      recoil_damage = recoil_result.applied;
      log.push({
        type: "recoil",
        turn: state.turn,
        phase: spec.phaseId,
        summary: `${attacker.name} took ${recoil_damage} recoil`,
        data: { slot: player_slot, damage: recoil_damage, target: attacker.id }
      });
      if (recoil_result.before > 0 && recoil_result.after === 0) {
        log.push({
          type: "faint",
          turn: state.turn,
          phase: spec.phaseId,
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
      phase: spec.phaseId,
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
      phase: spec.phaseId,
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
      phase: spec.phaseId,
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
      phase: spec.phaseId,
      summary: detail,
      data: { move: spec.id, damage: final_damage, blocked: was_blocked }
    });
  }

  handle_faint(state, log, other_slot(player_slot));
  if (recoil_num > 0 && recoil_den > 0) {
    handle_faint(state, log, player_slot);
  }
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
  for (const slot of ["player1", "player2"] as const) {
    if ((state.pendingWish?.[slot] ?? null) === state.turn) {
      actions.push({ player: slot, type: "wish", phase: "attack_01" });
    }
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
  const normalize_stats = (stats: Stats): Stats => ({
    level: normalize_int(stats.level, 1, 1),
    maxHp: normalize_int(stats.maxHp, 1, 1),
    attack: normalize_int(stats.attack, 0, 0),
    defense: normalize_int(stats.defense, 0, 0),
    speed: normalize_int(stats.speed, 0, 0)
  });

  const build_player = (slot: PlayerSlot): PlayerState => {
    const selection = teams[slot];
    const team = selection.monsters.map((monster) => {
      const stats = normalize_stats(monster.stats);
      return {
        id: monster.id,
        name: monster.id,
        hp: stats.maxHp,
        maxHp: stats.maxHp,
        level: stats.level,
        attack: stats.attack,
        defense: stats.defense,
        speed: stats.speed,
        possibleMoves: monster.moves.slice(),
        possiblePassives: [monster.passive],
        chosenMoves: monster.moves.slice(0, 4),
        chosenPassive: monster.passive,
        protectActiveThisTurn: false,
        endureActiveThisTurn: false,
        choiceBandLockedMoveIndex: null,
        protectCooldownTurns: 0
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
    pendingWish: empty_pending_wish()
  };
}

export function resolve_turn(
  state: GameState,
  intents: Record<PlayerSlot, PlayerIntent | null>
): { state: GameState; log: EventLog[] } {
  const next = clone_state(state);
  const log: EventLog[] = [];
  const hp_changed_this_turn = new WeakSet<MonsterState>();

  if (next.status !== "running") {
    return { state: next, log };
  }

  if (!next.pendingSwitch) {
    next.pendingSwitch = empty_pending();
  }
  if (!next.pendingWish) {
    next.pendingWish = empty_pending_wish();
  }

  reset_protect_flags(next);
  const actions = build_actions(intents, next);
  const phases = [...PHASES].sort((a, b) => a.order - b.order);

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
        apply_switch(next, log, action.player, action.targetIndex);
      } else if (action.type === "wish") {
        apply_pending_wish(next, log, action.player, hp_changed_this_turn);
      } else {
        apply_move(next, log, action.player, action.moveId, action.moveIndex, hp_changed_this_turn);
      }

      if (!any_alive(next.players.player1)) {
        next.status = "ended";
        next.winner = "player2";
        log.push({
          type: "match_end",
          turn: next.turn,
          summary: "player2 wins (all monsters down)",
          data: { winner: "player2" }
        });
        break;
      }
      if (!any_alive(next.players.player2)) {
        next.status = "ended";
        next.winner = "player1";
        log.push({
          type: "match_end",
          turn: next.turn,
          summary: "player1 wins (all monsters down)",
          data: { winner: "player1" }
        });
        break;
      }
    }

    if (next.status === "ended") {
      break;
    }
  }

  apply_passives(next, log, hp_changed_this_turn);
  decrement_cooldowns(next);
  // Clear protect after the turn resolves (so next turn starts unprotected).
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
  if (intent.action === "switch") {
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

  const moveId = active.chosenMoves[intent.moveIndex];
  if (moveId === "protect" && active.protectCooldownTurns > 0) {
    return "protect on cooldown";
  }

  return null;
}
