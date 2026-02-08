import type {
  EventLog,
  GameState,
  MonsterState,
  MoveId,
  PassiveId,
  PlayerIntent,
  PlayerSlot,
  PlayerState,
  TeamSelection
} from "./shared.ts";

type Phase = {
  id: string;
  name: string;
  order: number;
  initiative: Array<keyof Pick<MonsterState, "speed" | "attack" | "hp" | "defense">>;
};

type MoveSpec = {
  id: MoveId;
  name: string;
  phaseId: string;
  attackMultiplier100: number;
  attackMultiplierPerLevel100?: number;
  damageType?: "scaled" | "true" | "flat";
  flatDamage?: number;
  recoilNumerator?: number;
  recoilDenominator?: number;
};

type PassiveSpec = {
  id: PassiveId;
  name: string;
};

const INITIATIVE_DEFAULT: Phase["initiative"] = ["speed", "attack", "hp", "defense"];

const PHASES: Phase[] = [
  { id: "switch", name: "Switch", order: 0, initiative: INITIATIVE_DEFAULT },
  { id: "guard", name: "Guard", order: 1, initiative: INITIATIVE_DEFAULT },
  { id: "attack_01", name: "Attack 01", order: 2, initiative: INITIATIVE_DEFAULT }
];

const MOVE_SPECS: Record<string, MoveSpec> = {
  basic_attack: { id: "basic_attack", name: "Basic Attack", phaseId: "attack_01", attackMultiplier100: 110 },
  return: {
    id: "return",
    name: "Return",
    phaseId: "attack_01",
    attackMultiplier100: 72,
    attackMultiplierPerLevel100: 4
  },
  double_edge: {
    id: "double_edge",
    name: "Double-Edge",
    phaseId: "attack_01",
    attackMultiplier100: 120,
    recoilNumerator: 1,
    recoilDenominator: 3
  },
  seismic_toss: {
    id: "seismic_toss",
    name: "Seismic Toss",
    phaseId: "attack_01",
    attackMultiplier100: 100,
    damageType: "flat",
    flatDamage: 75
  },
  protect: { id: "protect", name: "Protect", phaseId: "guard", attackMultiplier100: 100 },
  none: { id: "none", name: "none", phaseId: "attack_01", attackMultiplier100: 100 }
};

const PASSIVE_SPECS: Record<string, PassiveSpec> = {
  none: { id: "none", name: "none" },
  regen_5pct: { id: "regen_5pct", name: "Regen 3%" }
};

type Action =
  | { player: PlayerSlot; type: "switch"; phase: string; targetIndex: number }
  | { player: PlayerSlot; type: "move"; phase: string; moveId: MoveId; moveIndex: number };

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
    protectCooldownTurns: monster.protectCooldownTurns
  };
}

function empty_pending(): Record<PlayerSlot, boolean> {
  return { player1: false, player2: false };
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
    pendingSwitch: { ...state.pendingSwitch }
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

function move_spec(moveId: MoveId): MoveSpec {
  return MOVE_SPECS[moveId] ?? MOVE_SPECS.none;
}

function passive_spec(passiveId: PassiveId): PassiveSpec {
  return PASSIVE_SPECS[passiveId] ?? PASSIVE_SPECS.none;
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

function apply_passives(state: GameState, log: EventLog[]): void {
  for_each_player(state, (player) => {
    const active = active_monster(player);
    if (!is_alive(active)) return;
    const spec = passive_spec(active.chosenPassive);
    if (spec.id === "regen_5pct") {
      const heal = Math.floor(active.maxHp * 0.05);
      if (heal > 0) {
        const before = active.hp;
        active.hp = Math.min(active.maxHp, active.hp + heal);
        const gained = active.hp - before;
        if (gained > 0) {
          log.push({
            type: "passive_heal",
            turn: state.turn,
            summary: `${player.slot} regen +${gained} HP`,
            data: { slot: player.slot, amount: gained, passive: spec.id }
          });
        }
      }
    }
  });
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

function apply_move(
  state: GameState,
  log: EventLog[],
  player_slot: PlayerSlot,
  move_id: MoveId,
  move_index: number
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

  const multiplier100 = spec.attackMultiplier100 + (spec.attackMultiplierPerLevel100 ?? 0) * attacker.level;
  const damage_type = spec.damageType ?? "scaled";
  const effective_defense = defender.defense <= 0 ? 1 : defender.defense;
  let raw_damage = 0;
  if (damage_type === "flat") {
    raw_damage = spec.flatDamage ?? 0;
  } else if (damage_type === "true") {
    raw_damage = Math.round((attacker.attack * multiplier100) / 100);
  } else {
    raw_damage = Math.round((attacker.attack * multiplier100) / (effective_defense * 100));
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

  const before = defender.hp;
  defender.hp = Math.max(0, defender.hp - damage);
  log.push({
    type: "damage",
    turn: state.turn,
    phase: spec.phaseId,
    summary: `${player_slot} dealt ${damage} to ${defender.name}`,
    data: { slot: player_slot, damage, target: defender.id }
  });

  if (before > 0 && defender.hp === 0) {
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
  if (recoil_num > 0 && recoil_den > 0 && damage > 0) {
    recoil_damage = Math.max(0, Math.round((damage * recoil_num) / recoil_den));
    if (recoil_damage > 0) {
      const attacker_before = attacker.hp;
      attacker.hp = Math.max(0, attacker.hp - recoil_damage);
      log.push({
        type: "recoil",
        turn: state.turn,
        phase: spec.phaseId,
        summary: `${attacker.name} took ${recoil_damage} recoil`,
        data: { slot: player_slot, damage: recoil_damage, target: attacker.id }
      });
      if (attacker_before > 0 && attacker.hp === 0) {
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

  if (spec.id === "return") {
    const detail = `Return: dmg = round(atk * (72 + 4*lvl) / (def*100)) = round(${attacker.attack} * ${multiplier100} / (${effective_defense}*100)) = ${raw_damage}; final=${damage}${
      was_blocked ? " (blocked by Protect)" : ""
    }`;
    log.push({
      type: "move_detail",
      turn: state.turn,
      phase: spec.phaseId,
      summary: detail,
      data: { move: spec.id, damage, blocked: was_blocked }
    });
  } else if (spec.id === "double_edge") {
    const detail = `Double-Edge: dmg = round(atk*120/(def*100)) = round(${attacker.attack}*120/(${effective_defense}*100)) = ${raw_damage}; final=${damage}${
      was_blocked ? " (blocked by Protect)" : ""
    }; recoil = round(final/3) = ${recoil_damage}`;
    log.push({
      type: "move_detail",
      turn: state.turn,
      phase: spec.phaseId,
      summary: detail,
      data: { move: spec.id, damage, recoil: recoil_damage, blocked: was_blocked }
    });
  } else if (spec.id === "seismic_toss") {
    const detail = `Seismic Toss: dmg = flat ${spec.flatDamage ?? 0} (ignores defense); final=${damage}${
      was_blocked ? " (blocked by Protect)" : ""
    }`;
    log.push({
      type: "move_detail",
      turn: state.turn,
      phase: spec.phaseId,
      summary: detail,
      data: { move: spec.id, damage, blocked: was_blocked }
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
  const build_player = (slot: PlayerSlot): PlayerState => {
    const selection = teams[slot];
    const team = selection.monsters.map((monster) => ({
      id: monster.id,
      name: monster.id,
      hp: monster.stats.maxHp,
      maxHp: monster.stats.maxHp,
      level: monster.stats.level,
      attack: monster.stats.attack,
      defense: monster.stats.defense,
      speed: monster.stats.speed,
      possibleMoves: monster.moves.slice(),
      possiblePassives: [monster.passive],
      chosenMoves: monster.moves.slice(0, 4),
      chosenPassive: monster.passive,
      protectActiveThisTurn: false,
      protectCooldownTurns: 0
    }));
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
    pendingSwitch: empty_pending()
  };
}

export function resolve_turn(
  state: GameState,
  intents: Record<PlayerSlot, PlayerIntent | null>
): { state: GameState; log: EventLog[] } {
  const next = clone_state(state);
  const log: EventLog[] = [];

  if (next.status !== "running") {
    return { state: next, log };
  }

  if (!next.pendingSwitch) {
    next.pendingSwitch = empty_pending();
  }

  reset_protect_flags(next);
  const actions = build_actions(intents, next);
  const phases = [...PHASES].sort((a, b) => a.order - b.order);

  for (const phase of phases) {
    const phase_actions = actions.filter((action) => action.phase === phase.id);
    if (phase_actions.length === 0) {
      continue;
    }

    if (phase_actions.length === 2) {
      const a = phase_actions[0];
      const b = phase_actions[1];
      const a_active = active_monster(next.players[a.player]);
      const b_active = active_monster(next.players[b.player]);
      const cmp = compare_initiative(a_active, b_active, phase.initiative);
      let first = a;
      let second = b;
      if (cmp < 0 || (cmp === 0 && a.player === "player2")) {
        first = b;
        second = a;
      }
      log.push({
        type: "initiative",
        turn: next.turn,
        phase: phase.id,
        summary: `${first.player} acts first in ${phase.name}`,
        data: { phase: phase.id }
      });
      phase_actions.splice(0, 2, first, second);
    }

    for (const action of phase_actions) {
      if (action.type === "switch") {
        apply_switch(next, log, action.player, action.targetIndex);
      } else {
        apply_move(next, log, action.player, action.moveId, action.moveIndex);
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

  apply_passives(next, log);
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

  const moveId = active.chosenMoves[intent.moveIndex];
  if (moveId === "protect" && active.protectCooldownTurns > 0) {
    return "protect on cooldown";
  }

  return null;
}
