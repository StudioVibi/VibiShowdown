import { create_initial_state, resolve_turn, validate_intent } from "./engine.ts";
import { MONSTER_BY_ID } from "./data/mon.ts";
import type { EVSpread, EventLog, GameState, MonsterConfig, PlayerIntent, PlayerSlot, TeamSelection } from "./shared.ts";

type TeamIds = [string, string, string];

const EMPTY_EV: EVSpread = { hp: 0, atk: 0, def: 0, spe: 0 };
const EMPTY_MOVES = ["none", "none", "none"];

function assert(condition: unknown, message: string): void {
  if (!condition) {
    throw new Error(`[engine-test] ${message}`);
  }
}

function assert_equal<T>(actual: T, expected: T, message: string): void {
  if (actual !== expected) {
    throw new Error(`[engine-test] ${message} (expected ${String(expected)}, got ${String(actual)})`);
  }
}

function monster_from_id(id: string, moves: string[]): MonsterConfig {
  const spec = MONSTER_BY_ID.get(id);
  if (!spec) {
    throw new Error(`[engine-test] unknown monster id: ${id}`);
  }
  return {
    id,
    moves: moves.slice(0, 3),
    passive: "none",
    type: spec.type,
    stats: { ...spec.stats },
    ev: { ...EMPTY_EV }
  };
}

function build_team(ids: TeamIds, active_moves: string[]): TeamSelection {
  return {
    monsters: [
      monster_from_id(ids[0], active_moves),
      monster_from_id(ids[1], EMPTY_MOVES),
      monster_from_id(ids[2], EMPTY_MOVES)
    ],
    activeIndex: 0
  };
}

function create_running_state(
  p1_moves: string[],
  p2_moves: string[],
  p1_ids: TeamIds = ["armoth", "kairus", "farien"],
  p2_ids: TeamIds = ["knight", "vealkiria", "babydragonbuf"]
): GameState {
  const state = create_initial_state(
    {
      player1: build_team(p1_ids, p1_moves),
      player2: build_team(p2_ids, p2_moves)
    },
    {
      player1: "p1",
      player2: "p2"
    }
  );
  state.status = "running";
  state.turn = 1;
  return state;
}

function p1_intent(intent: PlayerIntent): Record<PlayerSlot, PlayerIntent | null> {
  return { player1: intent, player2: null };
}

function first_player_damage(log: EventLog[]): number | null {
  for (const entry of log) {
    if (entry.type !== "damage") continue;
    const slot = entry.data?.slot;
    const damage = entry.data?.damage;
    if (slot === "player1" && typeof damage === "number") {
      return damage;
    }
  }
  return null;
}

{
  const state = create_running_state(["seismic_toss", "none", "none"], ["none", "none", "none"]);
  const error = validate_intent(state, "player1", { action: "use_move", moveIndex: 5 });
  assert_equal(error, "invalid move index", "validate_intent should reject out-of-range move index");
}

{
  const state = create_running_state(["bounce_kick", "none", "none"], ["none", "none", "none"]);
  const error = validate_intent(state, "player1", { action: "use_move", moveIndex: 0 });
  assert_equal(error, "bounce kick requires switch target", "bounce kick should require self switch target");
}

{
  const state = create_running_state(["none", "none", "none"], ["none", "none", "none"]);
  const error = validate_intent(state, "player1", { action: "switch", targetIndex: 0 });
  assert_equal(error, "already active", "switch to active monster should be rejected");
}

{
  const state = create_running_state(["none", "none", "none"], ["none", "none", "none"]);
  state.pendingSwitch.player1 = true;
  const error = validate_intent(state, "player1", { action: "run" });
  assert_equal(error, "pending switch", "pending switch should block normal intents");
}

{
  const state = create_running_state(["none", "none", "none"], ["none", "none", "none"]);
  const result = resolve_turn(state, p1_intent({ action: "switch", targetIndex: 1 }));
  assert_equal(state.players.player1.activeIndex, 0, "resolve_turn must not mutate original state active index");
  assert_equal(result.state.players.player1.activeIndex, 1, "switch intent should change active index");
  assert(result.log.some((entry) => entry.type === "switch"), "switch should generate switch event in log");
}

{
  const state = create_running_state(["seismic_toss", "none", "none"], ["none", "none", "none"]);
  const before = state.players.player2.sharedHp;
  const result = resolve_turn(state, p1_intent({ action: "use_move", moveIndex: 0 }));
  const damage = first_player_damage(result.log);
  assert(typeof damage === "number" && damage > 0, "seismic toss test should produce positive damage");
  if (damage === null) {
    throw new Error("[engine-test] seismic toss damage event missing");
  }
  const after = result.state.players.player2.sharedHp;
  assert_equal(after, before - damage, "shared HP should drop by logged damage");
  assert_equal(damage, 50, "seismic toss should deal flat 50 damage in baseline state");
}

{
  const state = create_running_state(["none", "none", "none"], ["none", "none", "none"]);
  const before = state.players.player1.sharedMSPE;
  const result = resolve_turn(state, p1_intent({ action: "run" }));
  const after = result.state.players.player1.sharedMSPE;
  assert_equal(before, 100, "baseline shared mSPE should start at 100");
  assert_equal(after, 110, "run should increase shared mSPE by 10%");
}

console.log("[engine-test] ok");
