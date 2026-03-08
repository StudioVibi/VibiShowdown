import { mul_div_round, normalize_int } from "../int_math.ts";
import { BASE_TURN_LIMIT, SHARED_MSPE_START } from "../shared.ts";
import type {
  EventLog,
  GameState,
  MatchEndReason,
  MSPETelemetry,
  PlayerSlot
} from "../shared.ts";
import {
  MSPE_GAP_GOAL_PERCENT,
  MSPE_VALUE_GOAL,
  SLOT_ORDER,
  type MatchProgress
} from "./constants.ts";
import { other_slot } from "./combat_state.ts";
import { empty_mSPE_telemetry } from "./state_helpers.ts";

export function end_match_with_winner(
  state: GameState,
  log: EventLog[],
  winner: PlayerSlot,
  summary: string,
  data?: Record<string, unknown>,
  end_reason?: MatchEndReason
): void {
  state.status = "ended";
  state.winner = winner;
  if (end_reason) {
    state.endReason = end_reason;
  }
  delete state.mSPESlots;
  log.push({
    type: "match_end",
    turn: state.turn,
    summary,
    data: { winner, ...(data ?? {}) }
  });
}

export function end_match_draw(
  state: GameState,
  log: EventLog[],
  summary: string,
  data?: Record<string, unknown>,
  end_reason?: MatchEndReason
): void {
  state.status = "ended";
  delete state.winner;
  if (end_reason) {
    state.endReason = end_reason;
  }
  delete state.mSPESlots;
  log.push({
    type: "match_end",
    turn: state.turn,
    summary,
    data: { ...(data ?? {}) }
  });
}

export function check_zero_hp_match_result(state: GameState, log: EventLog[]): MatchProgress {
  const p1_hp = state.players.player1.sharedHp;
  const p2_hp = state.players.player2.sharedHp;
  if (p1_hp > 0 && p2_hp > 0) {
    return "continue";
  }
  if (p1_hp <= 0 && p2_hp > 0) {
    end_match_with_winner(state, log, "player2", "player2 wins (enemy shared HP reached 0)", {
      player1Hp: p1_hp,
      player2Hp: p2_hp
    }, "hp_zero");
    return "ended";
  }
  if (p2_hp <= 0 && p1_hp > 0) {
    end_match_with_winner(state, log, "player1", "player1 wins (enemy shared HP reached 0)", {
      player1Hp: p1_hp,
      player2Hp: p2_hp
    }, "hp_zero");
    return "ended";
  }
  end_match_draw(state, log, "draw (both sides reached 0 HP)", {
    player1Hp: p1_hp,
    player2Hp: p2_hp
  }, "hp_zero");
  return "ended";
}

function build_mSPE_telemetry_entry(state: GameState, slot: PlayerSlot): MSPETelemetry {
  const enemy_slot = other_slot(slot);
  const effective_mSPE = Math.max(0, normalize_int(state.players[slot].sharedMSPE, SHARED_MSPE_START, 0));
  const enemy_effective_mSPE = Math.max(
    0,
    normalize_int(state.players[enemy_slot].sharedMSPE, SHARED_MSPE_START, 0)
  );
  const divisor = Math.max(1, enemy_effective_mSPE);
  const gap_percent = mul_div_round(effective_mSPE - enemy_effective_mSPE, 100, divisor);
  const evade_ready = effective_mSPE >= MSPE_VALUE_GOAL;
  const gap_ready = gap_percent >= MSPE_GAP_GOAL_PERCENT;
  return {
    effectiveMSPE: effective_mSPE,
    mSPEGoal: MSPE_VALUE_GOAL,
    mSPEReady: evade_ready,
    gapPercent: gap_percent,
    gapGoalPercent: MSPE_GAP_GOAL_PERCENT,
    gapReady: gap_ready,
    canMSPE: evade_ready || gap_ready
  };
}

export function refresh_mSPE_telemetry(state: GameState): void {
  if (!state.mSPETelemetry) {
    state.mSPETelemetry = empty_mSPE_telemetry();
  }
  state.mSPETelemetry.player1 = build_mSPE_telemetry_entry(state, "player1");
  state.mSPETelemetry.player2 = build_mSPE_telemetry_entry(state, "player2");
}

export function check_mSPE_match_result(state: GameState, log: EventLog[]): MatchProgress {
  refresh_mSPE_telemetry(state);
  if (state.status !== "running") {
    return state.status === "ended" ? "ended" : "continue";
  }
  const mSPE_slots = SLOT_ORDER.filter((slot) => state.mSPETelemetry[slot].canMSPE);
  if (mSPE_slots.length === 0) {
    return "continue";
  }

  state.status = "ended";
  state.endReason = "mSPE_escape";
  state.mSPESlots = mSPE_slots.slice();
  delete state.winner;

  const summary =
    mSPE_slots.length >= 2
      ? "double technical escape (both players satisfied mSPE condition)"
      : `${mSPE_slots[0]} escaped technically (mSPE condition met)`;
  log.push({
    type: "match_end",
    turn: state.turn,
    summary,
    data: {
      reason: "mSPE_escape",
      mSPESlots: mSPE_slots.slice(),
      telemetry: {
        player1: { ...state.mSPETelemetry.player1 },
        player2: { ...state.mSPETelemetry.player2 }
      }
    }
  });
  return "ended";
}

export function maybe_end_match_by_turn_limit(state: GameState, log: EventLog[]): void {
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
      { player1Hp: p1_hp, player2Hp: p2_hp },
      "turn_limit"
    );
    return;
  }

  end_match_draw(state, log, `draw after ${base_turn_limit} turns (equal shared HP)`, {
    player1Hp: p1_hp,
    player2Hp: p2_hp
  }, "turn_limit");
}
