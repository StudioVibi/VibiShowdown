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

function intents(p1: PlayerIntent | null, p2: PlayerIntent | null): Record<PlayerSlot, PlayerIntent | null> {
  return { player1: p1, player2: p2 };
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
  const state = create_running_state(["switch_sovietico", "none", "none"], ["none", "none", "none"]);
  const error = validate_intent(state, "player1", { action: "use_move", moveIndex: 0 });
  assert_equal(error, null, "switch sovietico should be valid when there is a bench target");
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

{
  const state = create_running_state(["hook", "none", "none"], ["none", "none", "none"]);
  const before_target = state.players.player2.sharedMSPE;
  const after_hook = resolve_turn(state, p1_intent({ action: "use_move", moveIndex: 0 })).state;
  const after_target = after_hook.players.player2.sharedMSPE;
  assert_equal(after_target, before_target, "hook should not reduce mSPE immediately when enemy does not attempt run");
}

{
  const state = create_running_state(["hook", "none", "none"], ["none", "none", "none"]);
  const before_target = state.players.player2.sharedMSPE;
  const result = resolve_turn(
    state,
    intents(
      { action: "use_move", moveIndex: 0 },
      { action: "run" }
    )
  );
  const after_target = result.state.players.player2.sharedMSPE;
  assert_equal(after_target, 80, "hook should apply -20% mSPE when enemy attempts run");
  assert(after_target < before_target, "hook run penalty should lower target mSPE");
  const player2_run_blocked = result.log.some((entry) => {
    if (entry.type !== "action_skipped") return false;
    const data = entry.data as { slot?: unknown; reason?: unknown } | undefined;
    return data?.slot === "player2" && data?.reason === "hook";
  });
  assert(player2_run_blocked, "hook should still block enemy run");
}

{
  const state = create_running_state(["hook", "none", "none"], ["none", "none", "none"]);
  const before_self_mSPE = state.players.player1.sharedMSPE;
  const after_hook = resolve_turn(state, p1_intent({ action: "use_move", moveIndex: 0 })).state;
  const after_self_mSPE = after_hook.players.player1.sharedMSPE;
  const armoth = after_hook.players.player1.team[0];
  const kairus = after_hook.players.player1.team[1];
  assert_equal(after_self_mSPE, 90, "hook should reduce caster shared mSPE by 10%");
  assert(after_self_mSPE < before_self_mSPE, "hook should lower caster shared mSPE");
  assert_equal(armoth.mSPE, after_self_mSPE, "hook mSPE penalty should affect active monster");
  assert_equal(kairus.mSPE, after_self_mSPE, "hook mSPE penalty should affect bench monster (shared resource)");
  assert_equal(armoth.speed, armoth.baseSpeed, "hook should not change caster DEX");
  assert_equal(kairus.speed, kairus.baseSpeed, "hook should not change bench DEX");

  const after_switch_out = resolve_turn(after_hook, p1_intent({ action: "switch", targetIndex: 1 })).state;
  const after_switch_back = resolve_turn(after_switch_out, p1_intent({ action: "switch", targetIndex: 0 })).state;
  assert_equal(
    after_switch_back.players.player1.sharedMSPE,
    after_self_mSPE,
    "hook self mSPE penalty should persist after switching out and back"
  );
}

{
  const baseline_state = create_running_state(["none", "none", "none"], ["punch", "none", "none"]);
  const baseline_before = baseline_state.players.player1.sharedHp;
  const baseline_after = resolve_turn(
    baseline_state,
    intents(
      { action: "use_move", moveIndex: 0 },
      { action: "use_move", moveIndex: 0 }
    )
  ).state;
  const baseline_damage_to_p1 = baseline_before - baseline_after.players.player1.sharedHp;

  const hook_state = create_running_state(["hook", "none", "none"], ["punch", "none", "none"]);
  const hook_before = hook_state.players.player1.sharedHp;
  const hook_after = resolve_turn(
    hook_state,
    intents(
      { action: "use_move", moveIndex: 0 },
      { action: "use_move", moveIndex: 0 }
    )
  ).state;
  const hook_damage_to_p1 = hook_before - hook_after.players.player1.sharedHp;
  assert(
    hook_damage_to_p1 > baseline_damage_to_p1,
    "hook exposure should increase incoming damage in attack phase"
  );
}

{
  const state = create_running_state(["power", "none", "none"], ["none", "none", "none"]);
  const after_power = resolve_turn(state, p1_intent({ action: "use_move", moveIndex: 0 })).state;
  const armoth = after_power.players.player1.team[0];
  const kairus = after_power.players.player1.team[1];
  assert(armoth.attack > armoth.baseAttack, "power should boost attack for the caster");
  assert(armoth.speed < armoth.baseSpeed, "power should reduce speed for the caster");
  assert_equal(kairus.attack, kairus.baseAttack, "power should not affect bench monster attack");
  assert_equal(kairus.speed, kairus.baseSpeed, "power should not affect bench monster speed");

  const after_switch_out = resolve_turn(after_power, p1_intent({ action: "switch", targetIndex: 1 })).state;
  assert_equal(after_switch_out.players.player1.activeIndex, 1, "switch should move to bench slot 1");
  const kairus_active = after_switch_out.players.player1.team[1];
  assert_equal(kairus_active.attack, kairus_active.baseAttack, "active replacement should not inherit power attack buff");
  assert_equal(kairus_active.speed, kairus_active.baseSpeed, "active replacement should not inherit power speed debuff");

  const after_switch_back = resolve_turn(after_switch_out, p1_intent({ action: "switch", targetIndex: 0 })).state;
  assert_equal(after_switch_back.players.player1.activeIndex, 0, "switch back should return to caster monster");
  const armoth_back = after_switch_back.players.player1.team[0];
  assert(armoth_back.attack > armoth_back.baseAttack, "power attack boost should persist after switching out and back");
  assert(armoth_back.speed < armoth_back.baseSpeed, "power speed debuff should persist after switching out and back");
}

console.log("[engine-test] ok");
