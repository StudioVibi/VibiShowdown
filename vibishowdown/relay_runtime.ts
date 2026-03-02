import { apply_forced_switch, create_initial_state, resolve_turn, validate_intent } from "../src/engine.ts";
import { is_room_info_post_envelope } from "../src/room_post_guards.ts";
import type { EventLog, GameState, PlayerIntent, PlayerSlot, RoomPost, TeamSelection } from "../src/shared.ts";

const PLAYER_SLOTS: PlayerSlot[] = ["player1", "player2"];

type RelayLocalRole = PlayerSlot | "spectator" | null;

type RelayRuntimeOptions = {
  player_id: string;
  relay_watcher_ttl_ms: number;
  turn_duration_ms: number;
  emit_local_post: (data: RoomPost) => void;
  append_chat: (line: string) => void;
};

function is_server_managed_post(data: RoomPost): boolean {
  return (
    data.$ === "assign" ||
    data.$ === "spectator" ||
    data.$ === "participants" ||
    data.$ === "ready_state" ||
    data.$ === "turn_start" ||
    data.$ === "state" ||
    data.$ === "intent_locked"
  );
}

function legacy_player_id(name: string): string {
  return `legacy:${name}`;
}

function relay_identity(data: RoomPost): string | null {
  const candidate = (data as { player_id?: unknown }).player_id;
  if (typeof candidate === "string" && candidate.length > 0) {
    return candidate;
  }
  if (data.$ === "join") {
    return legacy_player_id(data.name);
  }
  if (data.$ === "chat") {
    return legacy_player_id(data.from);
  }
  return null;
}

export class RelayRuntime {
  private readonly options: RelayRuntimeOptions;

  private relay_server_managed = false;
  private relay_ended = false;
  private relay_turn = 0;
  private relay_state: GameState | null = null;
  private relay_turn_timeout_id: number | null = null;
  private relay_turn_duration_ms: number;
  private relay_local_role: RelayLocalRole = null;
  private readonly relay_seen_indexes = new Set<number>();
  private readonly relay_names_by_id = new Map<string, string>();
  private readonly relay_last_seen_at = new Map<string, number>();
  private readonly relay_slot_by_id = new Map<string, PlayerSlot>();
  private readonly relay_ids_by_slot: Record<PlayerSlot, string | null> = { player1: null, player2: null };
  private readonly relay_join_order: string[] = [];
  private readonly relay_ready_order_ids: string[] = [];
  private readonly relay_team_by_id = new Map<string, TeamSelection>();
  private readonly relay_intents: Record<PlayerSlot, PlayerIntent | null> = { player1: null, player2: null };
  private readonly relay_forced_switch_intents: Record<PlayerSlot, number | null> = { player1: null, player2: null };

  constructor(options: RelayRuntimeOptions) {
    this.options = options;
    this.relay_turn_duration_ms = Math.max(1000, Math.floor(options.turn_duration_ms));
  }

  set_turn_duration_ms(next_ms: number): void {
    this.relay_turn_duration_ms = Math.max(1000, Math.floor(next_ms));
  }

  is_server_managed(): boolean {
    return this.relay_server_managed;
  }

  default_intent(state: GameState, slot_id: PlayerSlot): PlayerIntent {
    return this.relay_default_intent(state, slot_id);
  }

  consume_network_message(message: unknown): void {
    if (!is_room_info_post_envelope(message)) {
      return;
    }
    if (this.relay_seen_indexes.has(message.index)) {
      return;
    }
    this.relay_seen_indexes.add(message.index);
    const seen_at = message.server_time;
    const data = message.data;
    if (is_server_managed_post(data)) {
      this.relay_server_managed = true;
      this.emit_local_post(data);
      return;
    }
    if (this.relay_server_managed) {
      this.emit_local_post(data);
      return;
    }
    this.relay_consume_post(data, seen_at);
    this.relay_prune_inactive(seen_at);
  }

  prune_inactive(now_ms: number): void {
    this.relay_prune_inactive(now_ms);
  }

  private emit_local_post(data: RoomPost): void {
    this.options.emit_local_post(data);
  }

  private relay_name(id: string): string {
    return this.relay_names_by_id.get(id) ?? id;
  }

  private relay_names_by_slot(): Record<PlayerSlot, string | null> {
    const p1 = this.relay_ids_by_slot.player1;
    const p2 = this.relay_ids_by_slot.player2;
    return {
      player1: p1 ? this.relay_name(p1) : null,
      player2: p2 ? this.relay_name(p2) : null
    };
  }

  private relay_spectator_names(): string[] {
    return this.relay_join_order.filter((id) => !this.relay_slot_by_id.has(id)).map((id) => this.relay_name(id));
  }

  private relay_emit_snapshots(): void {
    const names = this.relay_names_by_slot();
    const ready: Record<PlayerSlot, boolean> = {
      player1: !!this.relay_ids_by_slot.player1,
      player2: !!this.relay_ids_by_slot.player2
    };
    const order: PlayerSlot[] = [];
    if (ready.player1) {
      order.push("player1");
    }
    if (ready.player2) {
      order.push("player2");
    }
    this.emit_local_post({
      $: "ready_state",
      ready,
      names,
      order
    });
    this.emit_local_post({
      $: "participants",
      players: names,
      spectators: this.relay_spectator_names()
    });
  }

  private relay_emit_local_role(): void {
    const local_slot = this.relay_slot_by_id.get(this.options.player_id);
    if (local_slot) {
      if (this.relay_local_role === local_slot) {
        return;
      }
      this.relay_local_role = local_slot;
      this.emit_local_post({
        $: "assign",
        slot: local_slot,
        token: this.options.player_id,
        name: this.relay_name(this.options.player_id)
      });
      return;
    }
    if (this.relay_join_order.includes(this.options.player_id)) {
      if (this.relay_local_role === "spectator") {
        return;
      }
      this.relay_local_role = "spectator";
      this.emit_local_post({ $: "spectator", name: this.relay_name(this.options.player_id) });
      return;
    }
    this.relay_local_role = null;
  }

  private relay_recompute_slots_from_ready_order(): void {
    this.relay_slot_by_id.clear();
    const p1 = this.relay_ready_order_ids[0] ?? null;
    const p2 = this.relay_ready_order_ids[1] ?? null;
    this.relay_ids_by_slot.player1 = p1;
    this.relay_ids_by_slot.player2 = p2;
    if (p1) {
      this.relay_slot_by_id.set(p1, "player1");
    }
    if (p2) {
      this.relay_slot_by_id.set(p2, "player2");
    }
  }

  private relay_reset_match_to_lobby(): void {
    this.relay_clear_turn_timer();
    this.relay_state = null;
    this.relay_ended = false;
    this.relay_turn = 0;
    this.relay_intents.player1 = null;
    this.relay_intents.player2 = null;
    this.relay_forced_switch_intents.player1 = null;
    this.relay_forced_switch_intents.player2 = null;
    this.relay_team_by_id.clear();
    this.relay_ready_order_ids.length = 0;
    this.relay_recompute_slots_from_ready_order();
    this.relay_emit_local_role();
    this.relay_emit_snapshots();
  }

  private relay_remove_participant(id: string): void {
    const join_idx = this.relay_join_order.indexOf(id);
    if (join_idx >= 0) {
      this.relay_join_order.splice(join_idx, 1);
    }
    this.relay_last_seen_at.delete(id);
    this.relay_names_by_id.delete(id);

    this.relay_team_by_id.delete(id);
    const ready_idx = this.relay_ready_order_ids.indexOf(id);
    if (ready_idx >= 0) {
      this.relay_ready_order_ids.splice(ready_idx, 1);
    }
    this.relay_recompute_slots_from_ready_order();
    this.relay_intents.player1 = null;
    this.relay_intents.player2 = null;
    this.relay_forced_switch_intents.player1 = null;
    this.relay_forced_switch_intents.player2 = null;
  }

  private relay_prune_inactive(now_ms: number): void {
    let changed = false;
    for (let i = this.relay_join_order.length - 1; i >= 0; i--) {
      const id = this.relay_join_order[i];
      const seen_at = this.relay_last_seen_at.get(id);
      if (typeof seen_at !== "number") {
        this.relay_remove_participant(id);
        changed = true;
        continue;
      }
      if (now_ms - seen_at <= this.options.relay_watcher_ttl_ms) {
        continue;
      }
      const slot_id = this.relay_slot_by_id.get(id);
      if (slot_id && this.relay_state?.status === "running") {
        continue;
      }
      this.relay_remove_participant(id);
      changed = true;
    }
    if (!changed) {
      return;
    }
    this.relay_emit_local_role();
    this.relay_emit_snapshots();
  }

  private relay_clear_turn_timer(): void {
    if (this.relay_turn_timeout_id === null) {
      return;
    }
    window.clearTimeout(this.relay_turn_timeout_id);
    this.relay_turn_timeout_id = null;
  }

  private relay_default_forced_switch_target(state: GameState, slot_id: PlayerSlot): number | null {
    const player = state.players[slot_id];
    for (let index = 0; index < player.team.length; index++) {
      if (index === player.activeIndex) {
        continue;
      }
      if (player.team[index].hp <= 0) {
        continue;
      }
      return index;
    }
    return null;
  }

  private relay_default_switch_target(state: GameState, slot_id: PlayerSlot): number | null {
    const player = state.players[slot_id];
    for (let index = 0; index < player.team.length; index++) {
      if (index === player.activeIndex) {
        continue;
      }
      if (player.team[index].hp <= 0) {
        continue;
      }
      return index;
    }
    return null;
  }

  private relay_default_self_switch_target(
    state: GameState,
    slot_id: PlayerSlot,
    move_id: string
  ): number | null {
    if (move_id !== "bounce_kick") {
      return null;
    }
    return this.relay_default_switch_target(state, slot_id);
  }

  private relay_default_intent(state: GameState, slot_id: PlayerSlot): PlayerIntent {
    const player = state.players[slot_id];
    const active = player.team[player.activeIndex];
    const none_index = active.chosenMoves.findIndex((move_id) => move_id === "none");
    if (none_index >= 0) {
      const none_intent: PlayerIntent = { action: "use_move", moveIndex: none_index };
      if (!validate_intent(state, slot_id, none_intent)) {
        return none_intent;
      }
    }
    for (let index = 0; index < active.chosenMoves.length; index++) {
      const move_id = active.chosenMoves[index] ?? "none";
      const self_switch_target = this.relay_default_self_switch_target(state, slot_id, move_id);
      const candidate: PlayerIntent = {
        action: "use_move",
        moveIndex: index,
        ...(typeof self_switch_target === "number" ? { selfSwitchTargetIndex: self_switch_target } : {})
      };
      if (!validate_intent(state, slot_id, candidate)) {
        return candidate;
      }
    }
    const run_intent: PlayerIntent = { action: "run" };
    if (!validate_intent(state, slot_id, run_intent)) {
      return run_intent;
    }
    const first_move_id = active.chosenMoves[0] ?? "none";
    const fallback_self_switch_target = this.relay_default_self_switch_target(state, slot_id, first_move_id);
    return {
      action: "use_move",
      moveIndex: 0,
      ...(typeof fallback_self_switch_target === "number"
        ? { selfSwitchTargetIndex: fallback_self_switch_target }
        : {})
    };
  }

  private relay_try_resolve_turn(trigger: "intent" | "timeout"): void {
    if (!this.relay_state || this.relay_ended) {
      return;
    }

    if (trigger === "timeout") {
      for (const slot_id of PLAYER_SLOTS) {
        if (this.relay_intents[slot_id]) {
          continue;
        }
        let validation_state = this.relay_state;
        if (this.relay_state.pendingSwitch[slot_id]) {
          const forced_target =
            this.relay_forced_switch_intents[slot_id] ?? this.relay_default_forced_switch_target(this.relay_state, slot_id);
          if (typeof forced_target === "number") {
            const forced_preview = apply_forced_switch(this.relay_state, slot_id, forced_target);
            if (!forced_preview.error) {
              this.relay_forced_switch_intents[slot_id] = forced_target;
              validation_state = forced_preview.state;
            }
          }
        }
        this.relay_intents[slot_id] = this.relay_default_intent(validation_state, slot_id);
        this.emit_local_post({ $: "intent_locked", slot: slot_id, turn: this.relay_turn });
      }
    }

    if (!this.relay_intents.player1 || !this.relay_intents.player2) {
      return;
    }
    for (const slot_check of PLAYER_SLOTS) {
      if (this.relay_state.pendingSwitch[slot_check] && !Number.isInteger(this.relay_forced_switch_intents[slot_check])) {
        return;
      }
    }

    let turn_state = this.relay_state;
    const pre_turn_log: EventLog[] = [];
    for (const slot_apply of PLAYER_SLOTS) {
      if (!turn_state.pendingSwitch[slot_apply]) {
        continue;
      }
      const target_candidate = this.relay_forced_switch_intents[slot_apply];
      if (typeof target_candidate !== "number" || !Number.isInteger(target_candidate)) {
        return;
      }
      const switch_result = apply_forced_switch(turn_state, slot_apply, target_candidate);
      if (switch_result.error) {
        return;
      }
      turn_state = switch_result.state;
      pre_turn_log.push(...switch_result.log);
    }
    const { state, log } = resolve_turn(turn_state, {
      player1: this.relay_intents.player1,
      player2: this.relay_intents.player2
    });
    this.relay_state = state;
    this.emit_local_post({ $: "state", turn: this.relay_turn, state: this.relay_state, log: [...pre_turn_log, ...log] });
    if (this.relay_state.status === "ended") {
      this.relay_ended = true;
      this.relay_reset_match_to_lobby();
      return;
    }
    this.relay_start_turn();
  }

  private relay_on_turn_timeout(expected_turn: number): void {
    if (expected_turn !== this.relay_turn) {
      return;
    }
    this.relay_try_resolve_turn("timeout");
  }

  private relay_start_turn(): void {
    if (!this.relay_state || this.relay_ended) {
      return;
    }
    this.relay_clear_turn_timer();
    this.relay_turn += 1;
    this.relay_state.turn = this.relay_turn;
    this.relay_intents.player1 = null;
    this.relay_intents.player2 = null;
    this.relay_forced_switch_intents.player1 = null;
    this.relay_forced_switch_intents.player2 = null;
    const turn_duration_ms = Math.max(1000, this.relay_turn_duration_ms);
    const deadline_at = Date.now() + turn_duration_ms;
    const scheduled_turn = this.relay_turn;
    this.relay_turn_timeout_id = window.setTimeout(() => this.relay_on_turn_timeout(scheduled_turn), turn_duration_ms);
    this.emit_local_post({
      $: "turn_start",
      turn: this.relay_turn,
      deadline_at,
      intents: { player1: false, player2: false }
    });
  }

  private relay_start_match_if_ready(): void {
    if (this.relay_state || this.relay_ended) {
      return;
    }
    const p1 = this.relay_ids_by_slot.player1;
    const p2 = this.relay_ids_by_slot.player2;
    if (!p1 || !p2) {
      return;
    }
    const p1_team = this.relay_team_by_id.get(p1);
    const p2_team = this.relay_team_by_id.get(p2);
    if (!p1_team || !p2_team) {
      return;
    }
    const names = this.relay_names_by_slot();
    try {
      this.relay_state = create_initial_state(
        {
          player1: p1_team,
          player2: p2_team
        },
        {
          player1: names.player1 || "player1",
          player2: names.player2 || "player2"
        }
      );
    } catch (error) {
      const message = error instanceof Error ? error.message : "invalid team";
      this.options.append_chat(`team error: ${message}`);
      return;
    }
    this.relay_state.status = "running";
    this.relay_turn = 0;
    this.emit_local_post({ $: "state", turn: 0, state: this.relay_state, log: [] });
    this.relay_start_turn();
  }

  private relay_handle_join(data: Extract<RoomPost, { $: "join" }>): void {
    const id = relay_identity(data);
    if (!id) {
      return;
    }
    const is_first_join = !this.relay_join_order.includes(id);
    this.relay_names_by_id.set(id, data.name);
    if (is_first_join) {
      this.relay_join_order.push(id);
      this.emit_local_post({ $: "join", name: data.name });
    }
    this.relay_emit_local_role();
    this.relay_emit_snapshots();
  }

  private relay_handle_ready(data: Extract<RoomPost, { $: "ready" }>): void {
    if (this.relay_state?.status === "running") {
      return;
    }
    const id = relay_identity(data);
    if (!id) {
      return;
    }
    if (!data.ready) {
      this.relay_team_by_id.delete(id);
      const idx = this.relay_ready_order_ids.indexOf(id);
      if (idx >= 0) {
        this.relay_ready_order_ids.splice(idx, 1);
      }
      this.relay_recompute_slots_from_ready_order();
      this.relay_emit_local_role();
      this.relay_emit_snapshots();
      return;
    }
    if (!data.team) {
      return;
    }
    this.relay_team_by_id.set(id, data.team);
    if (!this.relay_ready_order_ids.includes(id)) {
      this.relay_ready_order_ids.push(id);
    }
    this.relay_recompute_slots_from_ready_order();
    this.relay_emit_local_role();
    this.relay_emit_snapshots();
    this.relay_start_match_if_ready();
  }

  private relay_handle_intent(data: Extract<RoomPost, { $: "intent" }>): void {
    if (!this.relay_state || this.relay_ended) {
      return;
    }
    const id = relay_identity(data);
    if (!id) {
      return;
    }
    const slot_id = this.relay_slot_by_id.get(id);
    if (!slot_id) {
      return;
    }
    if (data.turn !== this.relay_turn) {
      return;
    }
    let validation_state = this.relay_state;
    if (this.relay_state.pendingSwitch[slot_id]) {
      const forced_target_candidate = Number.isInteger(data.forcedSwitchTargetIndex)
        ? data.forcedSwitchTargetIndex
        : this.relay_forced_switch_intents[slot_id];
      if (typeof forced_target_candidate !== "number" || !Number.isInteger(forced_target_candidate)) {
        return;
      }
      const forced_target = forced_target_candidate;
      const forced_preview = apply_forced_switch(this.relay_state, slot_id, forced_target);
      if (forced_preview.error) {
        return;
      }
      validation_state = forced_preview.state;
      this.relay_forced_switch_intents[slot_id] = forced_target;
    } else {
      this.relay_forced_switch_intents[slot_id] = null;
    }
    const validation = validate_intent(validation_state, slot_id, data.intent);
    if (validation) {
      return;
    }
    this.relay_intents[slot_id] = data.intent;
    this.relay_try_resolve_turn("intent");
  }

  private relay_handle_forced_switch(data: Extract<RoomPost, { $: "forced_switch" }>): void {
    if (!this.relay_state || this.relay_ended) {
      return;
    }
    const id = relay_identity(data);
    if (!id) {
      return;
    }
    const slot_id = this.relay_slot_by_id.get(id);
    if (!slot_id) {
      return;
    }
    if (!this.relay_state.pendingSwitch[slot_id]) {
      return;
    }
    const forced_preview = apply_forced_switch(this.relay_state, slot_id, data.targetIndex);
    if (forced_preview.error) {
      return;
    }
    this.relay_forced_switch_intents[slot_id] = data.targetIndex;
  }

  private relay_handle_surrender(data: Extract<RoomPost, { $: "surrender" }>): void {
    if (!this.relay_state || this.relay_ended || "loser" in data) {
      return;
    }
    const id = relay_identity(data);
    if (!id) {
      return;
    }
    const loser = this.relay_slot_by_id.get(id);
    if (!loser) {
      return;
    }
    const winner: PlayerSlot = loser === "player1" ? "player2" : "player1";
    this.relay_state.status = "ended";
    this.relay_state.winner = winner;
    this.relay_state.endReason = "surrender";
    delete this.relay_state.mSPESlots;
    this.relay_ended = true;
    const log: EventLog[] = [
      {
        type: "match_end",
        turn: this.relay_turn,
        summary: `${winner} wins (surrender)`,
        data: { winner, reason: "surrender" }
      }
    ];
    this.emit_local_post({ $: "state", turn: this.relay_turn, state: this.relay_state, log });
    this.emit_local_post({ $: "surrender", turn: this.relay_turn, loser, winner });
    this.relay_reset_match_to_lobby();
  }

  private relay_consume_post(data: RoomPost, seen_at: number): void {
    const id = relay_identity(data);
    if (id) {
      this.relay_last_seen_at.set(id, seen_at);
    }
    switch (data.$) {
      case "join":
        this.relay_handle_join(data);
        return;
      case "chat":
        this.emit_local_post(data);
        return;
      case "turn_config":
        this.emit_local_post(data);
        return;
      case "ready":
        this.relay_handle_ready(data);
        return;
      case "intent":
        this.relay_handle_intent(data);
        return;
      case "forced_switch":
        this.relay_handle_forced_switch(data);
        return;
      case "surrender":
        this.relay_handle_surrender(data);
        return;
      case "error":
        this.emit_local_post(data);
        return;
      default:
        return;
    }
  }
}
