import { move_spec } from "../data/moves.ts";
import type { CurseCollateralId } from "../data/types.ts";
import { mul_div_floor, mul_div_round, normalize_int } from "../int_math.ts";
import type { EventLog, GameState, MonsterState, PlayerSlot } from "../shared.ts";
import {
  END_PHASE_ID,
  END_TURN_EFFECT_ORDER,
  HAPPINESS_DURATION_AFTER_ENDING_APPLY,
  REJUVENATION_REGEN_HEAL_BUFF_ID,
  SEKYPS_DAMAGE_PER_STACK,
  SLOT_ORDER,
  TYPE_BUF_REGEN_HEAL_BUFF_ID,
  type EndTurnEffectId,
  type MatchProgress
} from "./constants.ts";
import { active_monster, other_slot, sync_player_shared_hp } from "./combat_state.ts";
import { is_alive } from "./turn_helpers.ts";

export type EndTurnContext = {
  apply_damage_move: (
    state: GameState,
    log: EventLog[],
    player_slot: PlayerSlot,
    spec: ReturnType<typeof move_spec>,
    hp_changed: WeakSet<MonsterState>,
    phase_id: string,
    took_damage_this_turn: Record<PlayerSlot, boolean>,
    damage_taken_this_turn: Record<PlayerSlot, number>,
    incoming_damage_multiplier_percent: Record<PlayerSlot, number>
  ) => void;
  apply_heal_amount: (
    state: GameState,
    slot: PlayerSlot,
    hp_changed: WeakSet<MonsterState>,
    heal_amount: number
  ) => { before: number; after: number; healed: number };
  apply_heal_buffs_end_turn_by_id: (
    state: GameState,
    log: EventLog[],
    slot: PlayerSlot,
    hp_changed: WeakSet<MonsterState>,
    heal_buff_id: string
  ) => void;
  upsert_curse: (
    state: GameState,
    log: EventLog[],
    target_slot: PlayerSlot,
    curse_id: CurseCollateralId,
    source_slot: PlayerSlot | null,
    source_move_id: string,
    options?: { remainingTurns?: number }
  ) => void;
  check_zero_hp_match_result: (state: GameState, log: EventLog[]) => MatchProgress;
};

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

function apply_rejuvenation_reactive_heal_end_turn(
  context: EndTurnContext,
  state: GameState,
  log: EventLog[],
  slot: PlayerSlot,
  hp_changed: WeakSet<MonsterState>,
  rejuvenation_used_this_turn: Record<PlayerSlot, boolean>,
  damage_taken_this_turn: Record<PlayerSlot, number>
): void {
  if (!rejuvenation_used_this_turn[slot]) {
    return;
  }
  const player = state.players[slot];
  const target = active_monster(player);
  const damage_taken = Math.max(0, normalize_int(damage_taken_this_turn[slot], 0, 0));
  if (damage_taken <= 0) {
    log.push({
      type: "rejuvenation_reactive_heal",
      turn: state.turn,
      phase: END_PHASE_ID,
      summary: `${target.name} used Rejuvenation but took no damage this turn`,
      data: { slot, target: target.id, damageTaken: 0, healApplied: 0 }
    });
    return;
  }
  const heal_attempt = Math.max(0, mul_div_floor(damage_taken, 1, 2));
  const result = context.apply_heal_amount(state, slot, hp_changed, heal_attempt);
  log.push({
    type: "rejuvenation_reactive_heal",
    turn: state.turn,
    phase: END_PHASE_ID,
    summary: `${target.name} healed ${result.healed} from Rejuvenation (50% of damage taken)`,
    data: {
      slot,
      target: target.id,
      damageTaken: damage_taken,
      healAttempted: heal_attempt,
      healApplied: result.healed,
      before: result.before,
      after: result.after
    }
  });
}

function apply_rejuvenation_regen_end_turn(
  context: EndTurnContext,
  state: GameState,
  log: EventLog[],
  slot: PlayerSlot,
  hp_changed: WeakSet<MonsterState>
): void {
  context.apply_heal_buffs_end_turn_by_id(state, log, slot, hp_changed, REJUVENATION_REGEN_HEAL_BUFF_ID);
}

function apply_type_passive_regen_end_turn(
  context: EndTurnContext,
  state: GameState,
  log: EventLog[],
  slot: PlayerSlot,
  hp_changed: WeakSet<MonsterState>
): void {
  context.apply_heal_buffs_end_turn_by_id(state, log, slot, hp_changed, TYPE_BUF_REGEN_HEAL_BUFF_ID);
}

function apply_curse_end_turn(
  state: GameState,
  log: EventLog[],
  hp_changed: WeakSet<MonsterState>,
  switched_this_turn: Record<PlayerSlot, boolean>
): void {
  for (const target_slot of SLOT_ORDER) {
    const curses = state.activeCursesBySlot[target_slot];
    if (!Array.isArray(curses) || curses.length === 0) {
      continue;
    }
    const target_player = state.players[target_slot];
    const target = active_monster(target_player);
    if (!is_alive(target)) {
      continue;
    }

    for (const curse of curses) {
      if (curse.id === "leech_seed") {
        const source_slot = curse.sourceSlot ?? other_slot(target_slot);
        const target_before = target_player.sharedHp;
        const drained_base = mul_div_floor(target_player.sharedHpMax, 1, 8);
        const drained_attempt = Math.max(0, drained_base * Math.max(1, curse.stacks));
        const drained = Math.min(target_before, drained_attempt);
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
          summary: `${target.name} lost ${drained} HP from Leech Seed`,
          data: {
            slot: source_slot,
            targetSlot: target_slot,
            source: source_slot,
            target: target.id,
            damage: drained,
            stacks: curse.stacks,
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
              summary: `${receiver.name} healed ${healed} HP from Leech Seed`,
              data: {
                slot: source_slot,
                source: source_slot,
                targetSlot: target_slot,
                target: target.id,
                heal: healed,
                stacks: curse.stacks,
                before: heal_before,
                after: heal_after
              }
            });
          }
        }
        continue;
      }

      if (curse.id === "sekyps") {
        if (switched_this_turn[target_slot]) {
          continue;
        }
        const current_stack = Math.max(1, normalize_int(curse.stacks, 1, 1));
        const applied_this_turn = typeof curse.appliedTurn === "number" && curse.appliedTurn === state.turn;
        const ticking_stack = applied_this_turn ? current_stack - 1 : current_stack;
        if (ticking_stack <= 0) {
          continue;
        }
        const source_slot = curse.sourceSlot ?? other_slot(target_slot);
        const damage_amount = ticking_stack * SEKYPS_DAMAGE_PER_STACK;
        const target_before = target_player.sharedHp;
        const damage = Math.min(target_before, Math.max(0, damage_amount));
        const target_after = target_before - damage;
        if (damage <= 0) {
          continue;
        }
        sync_player_shared_hp(state, target_slot, target_after);
        hp_changed.add(target);
        log.push({
          type: "sekyps_tick",
          turn: state.turn,
          phase: END_PHASE_ID,
          summary: `${target.name} lost ${damage} HP from Sekyps (stack ${ticking_stack})`,
          data: {
            slot: source_slot,
            targetSlot: target_slot,
            source: source_slot,
            target: target.id,
            damage,
            damageAmount: damage_amount,
            stack: ticking_stack,
            totalStack: current_stack,
            nextStack: current_stack,
            nextDamageAmount: current_stack * SEKYPS_DAMAGE_PER_STACK,
            appliedThisTurn: applied_this_turn,
            before: target_before,
            after: target_after
          }
        });
      }
    }
  }
}

function apply_focus_punch_end_turn(
  context: EndTurnContext,
  state: GameState,
  log: EventLog[],
  hp_changed: WeakSet<MonsterState>,
  focus_punch_pending: Record<PlayerSlot, boolean>,
  took_damage_this_turn: Record<PlayerSlot, boolean>,
  damage_taken_this_turn: Record<PlayerSlot, number>,
  incoming_damage_multiplier_percent: Record<PlayerSlot, number>
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
    context.apply_damage_move(
      state,
      log,
      slot,
      spec,
      hp_changed,
      END_PHASE_ID,
      took_damage_this_turn,
      damage_taken_this_turn,
      incoming_damage_multiplier_percent
    );
  }
}

function apply_pending_happiness_end_turn(
  context: EndTurnContext,
  state: GameState,
  log: EventLog[],
  pending_happiness_apply_by_slot: Record<PlayerSlot, boolean>
): void {
  for (const slot of SLOT_ORDER) {
    if (!pending_happiness_apply_by_slot[slot]) {
      continue;
    }
    const target = active_monster(state.players[slot]);
    if (!is_alive(target)) {
      continue;
    }
    context.upsert_curse(state, log, slot, "happiness", slot, "fervor", {
      remainingTurns: HAPPINESS_DURATION_AFTER_ENDING_APPLY
    });
  }
}

function apply_end_turn_effect(
  context: EndTurnContext,
  state: GameState,
  log: EventLog[],
  hp_changed: WeakSet<MonsterState>,
  effect_id: EndTurnEffectId,
  focus_punch_pending: Record<PlayerSlot, boolean>,
  took_damage_this_turn: Record<PlayerSlot, boolean>,
  switched_this_turn: Record<PlayerSlot, boolean>,
  rejuvenation_used_this_turn: Record<PlayerSlot, boolean>,
  damage_taken_this_turn: Record<PlayerSlot, number>,
  incoming_damage_multiplier_percent: Record<PlayerSlot, number>,
  pending_happiness_apply_by_slot: Record<PlayerSlot, boolean>
): void {
  if (effect_id === "focus_punch") {
    apply_focus_punch_end_turn(
      context,
      state,
      log,
      hp_changed,
      focus_punch_pending,
      took_damage_this_turn,
      damage_taken_this_turn,
      incoming_damage_multiplier_percent
    );
    return;
  }
  if (effect_id === "rejuvenation_reactive") {
    for (const slot of SLOT_ORDER) {
      apply_rejuvenation_reactive_heal_end_turn(
        context,
        state,
        log,
        slot,
        hp_changed,
        rejuvenation_used_this_turn,
        damage_taken_this_turn
      );
    }
    return;
  }
  if (effect_id === "wish") {
    for (const slot of SLOT_ORDER) {
      apply_pending_wish(state, log, slot, hp_changed);
    }
    return;
  }
  if (effect_id === "leech_life") {
    apply_curse_end_turn(state, log, hp_changed, switched_this_turn);
    return;
  }
  if (effect_id === "rejuvenation_regen") {
    for (const slot of SLOT_ORDER) {
      apply_rejuvenation_regen_end_turn(context, state, log, slot, hp_changed);
    }
    return;
  }
  if (effect_id === "type_regen") {
    for (const slot of SLOT_ORDER) {
      apply_type_passive_regen_end_turn(context, state, log, slot, hp_changed);
    }
    return;
  }
  apply_pending_happiness_end_turn(context, state, log, pending_happiness_apply_by_slot);
}

export function apply_end_turn_phase(
  context: EndTurnContext,
  state: GameState,
  log: EventLog[],
  hp_changed: WeakSet<MonsterState>,
  focus_punch_pending: Record<PlayerSlot, boolean>,
  took_damage_this_turn: Record<PlayerSlot, boolean>,
  switched_this_turn: Record<PlayerSlot, boolean>,
  rejuvenation_used_this_turn: Record<PlayerSlot, boolean>,
  damage_taken_this_turn: Record<PlayerSlot, number>,
  incoming_damage_multiplier_percent: Record<PlayerSlot, number>,
  pending_happiness_apply_by_slot: Record<PlayerSlot, boolean>
): MatchProgress {
  for (const effect_id of END_TURN_EFFECT_ORDER) {
    apply_end_turn_effect(
      context,
      state,
      log,
      hp_changed,
      effect_id,
      focus_punch_pending,
      took_damage_this_turn,
      switched_this_turn,
      rejuvenation_used_this_turn,
      damage_taken_this_turn,
      incoming_damage_multiplier_percent,
      pending_happiness_apply_by_slot
    );
    const progress = context.check_zero_hp_match_result(state, log);
    if (progress !== "continue") {
      return progress;
    }
  }
  return "continue";
}
