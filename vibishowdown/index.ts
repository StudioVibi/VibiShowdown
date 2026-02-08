import { gen_name, load, on_sync, ping, post, watch } from "../src/client.ts";
import type {
  EventLog,
  GameState,
  MonsterState,
  PlayerSlot,
  RoomPost,
  Stats,
  TeamSelection
} from "../src/shared.ts";

type MonsterSpec = {
  id: string;
  name: string;
  role: string;
  stats: Stats;
  possibleMoves: string[];
  possiblePassives: string[];
  defaultMoves: string[];
  defaultPassive: string;
};

type MonsterConfig = {
  moves: string[];
  passive: string;
  stats: Stats;
};

type Profile = {
  monsters: Record<string, MonsterConfig>;
};

const PLAYER_SLOTS: PlayerSlot[] = ["player1", "player2"];
const MOVE_OPTIONS = ["basic_attack", "return", "double_edge", "seismic_toss", "protect", "none"];
const PASSIVE_OPTIONS = ["none", "regen_5pct"];

const MOVE_LABELS: Record<string, string> = {
  basic_attack: "Basic Attack",
  return: "Return",
  double_edge: "Double-Edge",
  seismic_toss: "Seismic Toss",
  protect: "Protect",
  none: "none"
};

const PASSIVE_LABELS: Record<string, string> = {
  none: "none",
  regen_5pct: "Regen 3%"
};

const roster: MonsterSpec[] = [
  {
    id: "babydragon",
    name: "Baby Dragon TR",
    role: "Return Tester",
    stats: { level: 7, maxHp: 100, attack: 100, defense: 10, speed: 20 },
    possibleMoves: ["return", "none"],
    possiblePassives: ["none"],
    defaultMoves: ["return", "none", "none", "none"],
    defaultPassive: "none"
  },
  {
    id: "croni",
    name: "Croni DR",
    role: "Return Dummy",
    stats: { level: 7, maxHp: 100, attack: 10, defense: 10, speed: 10 },
    possibleMoves: ["none"],
    possiblePassives: ["none"],
    defaultMoves: ["none", "none", "none", "none"],
    defaultPassive: "none"
  },
  {
    id: "harpy",
    name: "Harpy TD",
    role: "Double-Edge Tester",
    stats: { level: 7, maxHp: 100, attack: 100, defense: 10, speed: 20 },
    possibleMoves: ["double_edge", "none"],
    possiblePassives: ["none"],
    defaultMoves: ["double_edge", "none", "none", "none"],
    defaultPassive: "none"
  },
  {
    id: "hoof",
    name: "Hoof DD",
    role: "Double-Edge Dummy",
    stats: { level: 7, maxHp: 100, attack: 10, defense: 10, speed: 10 },
    possibleMoves: ["none"],
    possiblePassives: ["none"],
    defaultMoves: ["none", "none", "none", "none"],
    defaultPassive: "none"
  },
  {
    id: "knight",
    name: "Knight TR",
    role: "Return Tester",
    stats: { level: 7, maxHp: 100, attack: 100, defense: 10, speed: 20 },
    possibleMoves: ["return", "none"],
    possiblePassives: ["none"],
    defaultMoves: ["return", "none", "none", "none"],
    defaultPassive: "none"
  },
  {
    id: "miren",
    name: "Miren DS",
    role: "Seismic Toss Dummy",
    stats: { level: 7, maxHp: 100, attack: 10, defense: 10, speed: 10 },
    possibleMoves: ["none"],
    possiblePassives: ["none"],
    defaultMoves: ["none", "none", "none", "none"],
    defaultPassive: "none"
  },
  {
    id: "panda",
    name: "Panda TS",
    role: "Seismic Toss Tester",
    stats: { level: 7, maxHp: 100, attack: 100, defense: 10, speed: 20 },
    possibleMoves: ["seismic_toss", "none"],
    possiblePassives: ["none"],
    defaultMoves: ["seismic_toss", "none", "none", "none"],
    defaultPassive: "none"
  },
  {
    id: "valkyria",
    name: "Valkyria DR",
    role: "Return Dummy",
    stats: { level: 7, maxHp: 100, attack: 10, defense: 10, speed: 10 },
    possibleMoves: ["none"],
    possiblePassives: ["none"],
    defaultMoves: ["none", "none", "none", "none"],
    defaultPassive: "none"
  }
];

const roster_by_id = new Map<string, MonsterSpec>(roster.map((entry) => [entry.id, entry]));

const room = prompt("Room name?") || gen_name();
const player_name = prompt("Your name?") || gen_name();

const token_key = `vibi_showdown_token:${room}:${player_name}`;
let stored_token = localStorage.getItem(token_key) || undefined;
const profile_key = `vibi_showdown_profile:${player_name}`;
const team_key = `vibi_showdown_team:${room}:${player_name}`;

const status_room = document.getElementById("status-room")!;
const status_name = document.getElementById("status-name")!;
const status_slot = document.getElementById("status-slot");
const status_conn = document.getElementById("status-conn");
const status_ping = document.getElementById("status-ping")!;
const status_turn = document.getElementById("status-turn")!;
const status_deadline = document.getElementById("status-deadline")!;
const status_ready = document.getElementById("status-ready");
const status_opponent = document.getElementById("status-opponent");
const log_list = document.getElementById("log-list");
const chat_messages = document.getElementById("chat-messages")!;
const chat_input = document.getElementById("chat-input") as HTMLInputElement | null;
const chat_send = document.getElementById("chat-send") as HTMLButtonElement | null;
const participants_list = document.getElementById("participants-list")!;

const player_title = document.getElementById("player-name")!;
const player_meta = document.getElementById("player-meta")!;
const enemy_title = document.getElementById("enemy-name")!;
const enemy_meta = document.getElementById("enemy-meta")!;
const enemy_hp = document.getElementById("enemy-hp")!;
const player_hp = document.getElementById("player-hp")!;
const player_sprite = document.getElementById("player-sprite") as HTMLImageElement;
const enemy_sprite = document.getElementById("enemy-sprite") as HTMLImageElement;
const player_sprite_wrap = document.getElementById("player-sprite-wrap") as HTMLDivElement;
const enemy_sprite_wrap = document.getElementById("enemy-sprite-wrap") as HTMLDivElement;

const prematch = document.getElementById("prematch")!;
const prematch_hint = document.getElementById("prematch-hint")!;
const ready_btn = document.getElementById("ready-btn")!;
const move_buttons = [
  document.getElementById("move-btn-0") as HTMLButtonElement,
  document.getElementById("move-btn-1") as HTMLButtonElement,
  document.getElementById("move-btn-2") as HTMLButtonElement,
  document.getElementById("move-btn-3") as HTMLButtonElement
];
const switch_btn = document.getElementById("switch-btn") as HTMLButtonElement | null;
const surrender_btn = document.getElementById("surrender-btn") as HTMLButtonElement;
const switch_modal = document.getElementById("switch-modal") as HTMLDivElement;
const switch_options = document.getElementById("switch-options") as HTMLDivElement;
const switch_close = document.getElementById("switch-close") as HTMLButtonElement;

const roster_count = document.getElementById("roster-count")!;
const slot_active = document.getElementById("slot-active") as HTMLButtonElement;
const slot_bench_a = document.getElementById("slot-bench-a") as HTMLButtonElement;
const slot_bench_b = document.getElementById("slot-bench-b") as HTMLButtonElement;
const slot_active_name = document.getElementById("slot-active-name")!;
const slot_bench_a_name = document.getElementById("slot-bench-a-name")!;
const slot_bench_b_name = document.getElementById("slot-bench-b-name")!;
const slot_active_img = document.getElementById("slot-active-img") as HTMLImageElement;
const slot_bench_a_img = document.getElementById("slot-bench-a-img") as HTMLImageElement;
const slot_bench_b_img = document.getElementById("slot-bench-b-img") as HTMLImageElement;
const monster_tabs = document.getElementById("monster-tabs");
const moves_grid = document.getElementById("moves-grid")!;
const passive_grid = document.getElementById("passive-grid")!;
const stats_grid = document.getElementById("stats-grid")!;
const config_warning = document.getElementById("config-warning")!;
const player_bench_slots = [
  {
    btn: document.getElementById("player-bench-0") as HTMLButtonElement,
    img: document.getElementById("player-bench-0-img") as HTMLImageElement
  },
  {
    btn: document.getElementById("player-bench-1") as HTMLButtonElement,
    img: document.getElementById("player-bench-1-img") as HTMLImageElement
  }
];
const enemy_bench_slots = [
  {
    btn: document.getElementById("enemy-bench-0") as HTMLButtonElement,
    img: document.getElementById("enemy-bench-0-img") as HTMLImageElement
  },
  {
    btn: document.getElementById("enemy-bench-1") as HTMLButtonElement,
    img: document.getElementById("enemy-bench-1-img") as HTMLImageElement
  }
];

const match_end = document.getElementById("match-end") as HTMLDivElement;
const match_end_title = document.getElementById("match-end-title") as HTMLDivElement;
const match_end_sub = document.getElementById("match-end-sub") as HTMLDivElement;
const match_end_btn = document.getElementById("match-end-btn") as HTMLButtonElement;

status_room.textContent = room;
status_name.textContent = player_name;
player_title.textContent = player_name;
enemy_title.textContent = "Opponent";
document.body.classList.add("prematch-open");

let current_turn = 0;
let deadline_at = 0;
let slot: PlayerSlot | null = null;
let is_ready = false;
let match_started = false;
let latest_state: GameState | null = null;
let opponent_ready = false;
let opponent_name: string | null = null;
let is_spectator = false;
let last_ready_snapshot: Record<PlayerSlot, boolean> | null = null;
let participants: { players: Record<PlayerSlot, string | null>; spectators: string[] } | null = null;
let ready_order: PlayerSlot[] = [];
let intent_locked = false;
const hp_animation: { player?: number; enemy?: number } = {};
const animation_timers: number[] = [];
const sprite_fx_classes = ["jump", "hit", "heal", "shield-on", "shield-hit"];

const selected: string[] = [];
let active_tab: string | null = null;

function icon_path(id: string): string {
  return `/icons/unit_${id}.png`;
}

function monster_label(id?: string, fallback: string = "mon"): string {
  if (!id) return fallback;
  return roster_by_id.get(id)?.name ?? id;
}

function append_log(line: string): void {
  append_line(log_list, line);
}

function append_chat(line: string): void {
  append_line(chat_messages, line);
}

function send_chat_message(message: string): void {
  const trimmed = message.trim();
  if (!trimmed) return;
  post(room, { $: "chat", message: trimmed.slice(0, 200), from: player_name });
}

function setup_chat_input(input: HTMLInputElement | null, button: HTMLButtonElement | null): void {
  if (!input || !button) return;
  input.disabled = false;
  button.disabled = false;
  input.placeholder = "Type message...";
  const handler = () => {
    send_chat_message(input.value);
    input.value = "";
  };
  button.addEventListener("click", handler);
  input.addEventListener("keydown", (event) => {
    if (event.key === "Enter") {
      handler();
    }
  });
}

function append_line(container: HTMLElement | null, line: string): void {
  if (!container) return;
  const p = document.createElement("p");
  p.textContent = line;
  container.appendChild(p);
  container.scrollTop = container.scrollHeight;
}

function render_participants(): void {
  participants_list.innerHTML = "";
  if (!participants) {
    return;
  }
  for (const slot_id of PLAYER_SLOTS) {
    const name = participants.players[slot_id];
    if (!name) continue;
    const item = document.createElement("div");
    item.className = "participant";
    const meta = slot_id === "player1" ? "P1" : "P2";
    item.innerHTML = `<span>${name}</span><span class="participant-meta">${meta}</span>`;
    participants_list.appendChild(item);
  }
  const spectators = participants.spectators.slice().sort((a, b) => a.localeCompare(b, undefined, { sensitivity: "base" }));
  for (const name of spectators) {
    const item = document.createElement("div");
    item.className = "participant";
    item.innerHTML = `<span>${name}</span><span class="participant-meta">spec</span>`;
    participants_list.appendChild(item);
  }
}

function update_deadline(): void {
  if (deadline_at <= 0) {
    status_deadline.textContent = "--:--";
    return;
  }
  const remaining = Math.max(0, deadline_at - Date.now());
  const minutes = Math.floor(remaining / 60000);
  const seconds = Math.floor((remaining % 60000) / 1000);
  status_deadline.textContent = `${minutes.toString().padStart(2, "0")}:${seconds
    .toString()
    .padStart(2, "0")}`;
}

function show_warning(message: string): void {
  config_warning.textContent = message;
}

function clear_warning(): void {
  config_warning.textContent = "";
}

function load_json<T>(key: string, fallback: T): T {
  try {
    const raw = localStorage.getItem(key);
    if (!raw) return fallback;
    return JSON.parse(raw) as T;
  } catch {
    return fallback;
  }
}

function save_json<T>(key: string, value: T): void {
  try {
    localStorage.setItem(key, JSON.stringify(value));
  } catch {}
}

function load_profile(): Profile {
  const parsed = load_json<Profile | null>(profile_key, null);
  if (parsed && typeof parsed === "object" && parsed.monsters) {
    return { monsters: parsed.monsters as Record<string, MonsterConfig> };
  }
  return { monsters: {} };
}

const profile = load_profile();

function save_profile(): void {
  save_json(profile_key, profile);
}

function load_team_selection(): void {
  const parsed = load_json<{ selected?: string[] } | null>(team_key, null);
  if (parsed && Array.isArray(parsed.selected)) {
    selected.splice(0, selected.length, ...parsed.selected.filter((id: string) => roster_by_id.has(id)));
  }
}

function save_team_selection(): void {
  save_json(team_key, { selected: selected.slice() });
}

function coerce_config(spec: MonsterSpec, value?: MonsterConfig): MonsterConfig {
  const base: MonsterConfig = {
    moves: spec.defaultMoves.slice(0, 4),
    passive: spec.defaultPassive,
    stats: { ...spec.stats }
  };

  if (!value) {
    return base;
  }

  const moves = Array.isArray(value.moves) ? value.moves.slice(0, 4) : base.moves.slice();
  while (moves.length < 4) {
    moves.push("none");
  }
  const allowed = new Set(spec.possibleMoves);
  for (let i = 0; i < moves.length; i++) {
    if (!allowed.has(moves[i])) {
      moves[i] = "none";
    }
  }

  return {
    moves,
    passive: value.passive || base.passive,
    stats: { ...base.stats, ...(value.stats || {}) }
  };
}

function get_config(monster_id: string): MonsterConfig {
  const spec = roster_by_id.get(monster_id);
  if (!spec) {
    throw new Error(`Missing monster spec: ${monster_id}`);
  }
  const config = coerce_config(spec, profile.monsters[monster_id]);
  profile.monsters[monster_id] = config;
  save_profile();
  return config;
}

function update_roster_count(): void {
  roster_count.textContent = `${selected.length}/3`;
}

function set_slot_card(
  index: number,
  card: HTMLButtonElement,
  img: HTMLImageElement,
  name_el: HTMLElement
): void {
  const id = selected[index];
  card.classList.toggle("show-badge", index === 0);
  if (!id) {
    card.classList.add("empty");
    card.classList.remove("active");
    img.classList.add("hidden");
    img.removeAttribute("src");
    img.alt = "";
    name_el.textContent = "empty";
    return;
  }
  card.classList.remove("empty");
  card.classList.toggle("active", id === active_tab);
  img.classList.remove("hidden");
  img.src = icon_path(id);
  img.alt = monster_label(id);
  name_el.textContent = monster_label(id);
}

function update_slots(): void {
  set_slot_card(0, slot_active, slot_active_img, slot_active_name);
  set_slot_card(1, slot_bench_a, slot_bench_a_img, slot_bench_a_name);
  set_slot_card(2, slot_bench_b, slot_bench_b_img, slot_bench_b_name);
}

function render_tabs(): void {
  if (monster_tabs) {
    monster_tabs.innerHTML = "";
  }
  if (selected.length === 0) {
    active_tab = null;
    render_config();
    return;
  }

  if (!active_tab || !selected.includes(active_tab)) {
    active_tab = selected[0];
  }
  render_config();
}

function render_config(): void {
  moves_grid.innerHTML = "";
  passive_grid.innerHTML = "";
  stats_grid.innerHTML = "";

  if (!active_tab) {
    show_warning("Select 3 monsters to configure.");
    return;
  }

  clear_warning();
  const spec = roster_by_id.get(active_tab);
  if (!spec) {
    show_warning("Unknown monster.");
    return;
  }

  const config = get_config(active_tab);

  for (let i = 0; i < 4; i++) {
    const label = document.createElement("label");
    label.textContent = `Move ${i + 1}`;
    const select = document.createElement("select");
    select.dataset.index = `${i}`;
    for (const move of spec.possibleMoves) {
      const option = document.createElement("option");
      option.value = move;
      option.textContent = MOVE_LABELS[move] || move;
      select.appendChild(option);
    }
    select.value = config.moves[i] ?? "none";
    select.dataset.prev = select.value;
    select.disabled = is_ready && !match_started;
    select.addEventListener("change", () => {
      if (is_ready && !match_started) {
        select.value = select.dataset.prev || "none";
        return;
      }
      const idx = Number(select.dataset.index);
      const next = select.value;
      const prev = select.dataset.prev || "none";
      if (next !== "none") {
        const duplicate = config.moves.some((value, other) => other !== idx && value === next);
        if (duplicate) {
          select.value = prev;
          show_warning("Moves cannot repeat (except 'none').");
          return;
        }
      }
      config.moves[idx] = next;
      select.dataset.prev = next;
      clear_warning();
      save_profile();
      update_action_controls();
    });
    label.appendChild(select);
    moves_grid.appendChild(label);
  }

  const passive_label = document.createElement("label");
  passive_label.textContent = "Passive";
  const passive_select = document.createElement("select");
  for (const passive of spec.possiblePassives) {
    const option = document.createElement("option");
    option.value = passive;
    option.textContent = PASSIVE_LABELS[passive] || passive;
    passive_select.appendChild(option);
  }
  passive_select.value = config.passive;
  passive_select.disabled = is_ready && !match_started;
  passive_select.addEventListener("change", () => {
    if (is_ready && !match_started) return;
    config.passive = passive_select.value;
    save_profile();
  });
  passive_label.appendChild(passive_select);
  passive_grid.appendChild(passive_label);

  const stat_fields: Array<[keyof Stats, string]> = [
    ["level", "Level"],
    ["maxHp", "Max HP"],
    ["attack", "Attack"],
    ["defense", "Defense"],
    ["speed", "Speed"]
  ];
  for (const [key, label_text] of stat_fields) {
    const label = document.createElement("label");
    label.textContent = label_text;
    const input = document.createElement("input");
    input.type = "number";
    input.value = `${config.stats[key]}`;
    input.disabled = is_ready && !match_started;
    input.addEventListener("change", () => {
      if (is_ready && !match_started) return;
      const value = Number(input.value);
      if (!Number.isFinite(value)) {
        return;
      }
      config.stats[key] = value;
      save_profile();
    });
    label.appendChild(input);
    stats_grid.appendChild(label);
  }
}

function set_edit_target(index: number): void {
  if (is_ready && !match_started) {
    return;
  }
  const id = selected[index];
  if (!id) {
    return;
  }
  active_tab = id;
  update_slots();
  render_config();
}

function toggle_selection(id: string): void {
  if (is_ready && !match_started) {
    return;
  }
  const index = selected.indexOf(id);
  if (index >= 0) {
    selected.splice(index, 1);
    if (active_tab === id) {
      active_tab = selected[0] || null;
    }
    save_team_selection();
    update_roster_count();
    update_slots();
    render_tabs();
    render_config();
    render_roster();
    update_action_controls();
    return;
  }

  if (selected.length >= 3) {
    show_warning("Choose exactly 3 monsters.");
    return;
  }

  selected.push(id);
  active_tab = id;
  save_team_selection();
  update_roster_count();
  update_slots();
  render_tabs();
  render_config();
  render_roster();
  update_action_controls();
}

function render_roster(): void {
  const list = document.getElementById("roster-list")!;
  list.innerHTML = "";
  for (const entry of roster) {
    const card = document.createElement("div");
    const is_selected = selected.includes(entry.id);
    const is_disabled = (!is_selected && selected.length >= 3) || (is_ready && !match_started);
    card.className = `roster-card${is_selected ? " active" : ""}${is_disabled ? " disabled" : ""}`;
    card.innerHTML = `
      <div class="sprite" style="width:24px;height:24px;">
        <img src="${icon_path(entry.id)}" alt="${entry.name}" />
      </div>
      <div>
        <h4>${entry.name}</h4>
        <p>${entry.role}</p>
      </div>
    `;
    card.addEventListener("click", () => {
      if (is_disabled) return;
      toggle_selection(entry.id);
    });
    list.appendChild(card);
  }
}

type BenchSlotEl = { btn: HTMLButtonElement; img: HTMLImageElement };

function set_bench_slot(slot: BenchSlotEl, mon: MonsterState | null, index: number | null, enabled: boolean): void {
  if (!mon || index === null || index < 0) {
    slot.btn.classList.add("empty");
    slot.btn.disabled = true;
    slot.btn.removeAttribute("data-index");
    slot.btn.title = "";
    slot.img.removeAttribute("src");
    slot.img.alt = "";
    slot.img.style.display = "none";
    return;
  }
  slot.btn.classList.remove("empty");
  slot.btn.dataset.index = `${index}`;
  slot.btn.title = monster_label(mon.id);
  slot.btn.disabled = !enabled || mon.hp <= 0;
  slot.img.src = icon_path(mon.id);
  slot.img.alt = monster_label(mon.id);
  slot.img.style.display = "";
}

function update_bench(state: GameState, viewer_slot: PlayerSlot): void {
  const me = state.players[viewer_slot];
  const opp = state.players[viewer_slot === "player1" ? "player2" : "player1"];
  const my_bench = me.team.map((_, idx) => idx).filter((idx) => idx !== me.activeIndex);
  const opp_bench = opp.team.map((_, idx) => idx).filter((idx) => idx !== opp.activeIndex);
  const can_switch =
    !!slot &&
    slot === viewer_slot &&
    match_started &&
    !is_spectator &&
    (!!has_pending_switch() || (!intent_locked && current_turn > 0));

  player_bench_slots.forEach((slot_el, i) => {
    const idx = my_bench[i] ?? null;
    const mon = idx !== null ? me.team[idx] : null;
    set_bench_slot(slot_el, mon, idx, can_switch);
  });
  enemy_bench_slots.forEach((slot_el, i) => {
    const idx = opp_bench[i] ?? null;
    const mon = idx !== null ? opp.team[idx] : null;
    set_bench_slot(slot_el, mon, idx, false);
  });
}

function update_action_controls(): void {
  const has_team = selected.length === 3;
  const pending_switch = has_pending_switch();
  const controls_disabled = !match_started || !slot || is_spectator || intent_locked || current_turn <= 0 || pending_switch;
  if (!has_team) {
    move_buttons.forEach((btn, index) => {
      btn.textContent = `Move ${index + 1}`;
      btn.disabled = true;
    });
    if (switch_btn) switch_btn.disabled = true;
    return;
  }

  const active_id = selected[0];
  const config = get_config(active_id);
  let protect_on_cooldown = false;
  let active_moves = config.moves;
  if (latest_state && slot) {
    const active_state = latest_state.players[slot].team[latest_state.players[slot].activeIndex];
    protect_on_cooldown = active_state.protectCooldownTurns > 0;
    active_moves = active_state.chosenMoves;
  }
  move_buttons.forEach((btn, index) => {
    const move = active_moves[index] ?? "none";
    const label = MOVE_LABELS[move] || move;
    if (move === "protect" && protect_on_cooldown) {
      btn.textContent = `${index + 1}. Protect (cooldown)`;
      btn.disabled = true;
    } else {
      btn.textContent = `${index + 1}. ${label}`;
      btn.disabled = controls_disabled;
    }
  });
  if (switch_btn) {
    const switch_disabled =
      !match_started ||
      !slot ||
      is_spectator ||
      (!pending_switch && intent_locked) ||
      (!pending_switch && current_turn <= 0);
    switch_btn.disabled = switch_disabled;
  }
  const show_surrender = match_started && !!slot && !is_spectator;
  surrender_btn.classList.toggle("hidden", !show_surrender);
  surrender_btn.disabled = !show_surrender;
  if (latest_state) {
    const viewer_slot = slot ?? (is_spectator ? "player1" : null);
    if (viewer_slot) {
      update_bench(latest_state, viewer_slot);
    }
  }
}

function has_pending_switch(): boolean {
  return !!(latest_state && slot && latest_state.pendingSwitch?.[slot]);
}

function can_send_intent(): boolean {
  if (current_turn <= 0) {
    append_log("turn not active yet");
    return false;
  }
  if (!slot) {
    append_log("slot not assigned");
    return false;
  }
  if (is_spectator) {
    return false;
  }
  if (intent_locked) {
    append_log("intent already locked");
    return false;
  }
  if (has_pending_switch()) {
    append_log("pending switch");
    return false;
  }
  return true;
}

function send_move_intent(moveIndex: number): void {
  if (!can_send_intent()) return;
  post(room, { $: "intent", turn: current_turn, intent: { action: "use_move", moveIndex } });
  intent_locked = true;
  update_action_controls();
  append_log("intent sent");
}

function send_switch_intent(targetIndex: number): void {
  if (has_pending_switch()) {
    post(room, { $: "forced_switch", targetIndex });
    close_switch_modal();
    return;
  }
  if (!can_send_intent()) return;
  post(room, { $: "intent", turn: current_turn, intent: { action: "switch", targetIndex } });
  intent_locked = true;
  update_action_controls();
  append_log("intent sent");
}

function send_surrender(): void {
  if (!match_started || is_spectator || !slot) return;
  post(room, { $: "surrender" });
}

function close_switch_modal(): void {
  switch_modal.classList.remove("open");
}

function open_switch_modal(mode: "intent" | "forced" = "intent"): void {
  if (!latest_state || !slot) return;
  if (mode === "intent" && !can_send_intent()) return;
  switch_options.innerHTML = "";
  const player = latest_state.players[slot];
  const active_index = player.activeIndex;
  const options = player.team
    .map((mon, index) => ({ mon, index }))
    .filter((entry) => entry.index !== active_index);
  if (options.length === 0) {
    const msg = document.createElement("div");
    msg.textContent = "No available swaps";
    msg.style.fontSize = "11px";
    msg.style.color = "#9aa5b1";
    switch_options.appendChild(msg);
  } else {
    for (const entry of options) {
      const button = document.createElement("button");
      const is_alive = entry.mon.hp > 0;
      button.disabled = !is_alive;
      button.textContent = `${entry.mon.name}${is_alive ? "" : " (fainted)"}`;
      button.addEventListener("click", () => {
        if (mode === "intent") {
          if (!can_send_intent()) return;
          post(room, { $: "intent", turn: current_turn, intent: { action: "switch", targetIndex: entry.index } });
          intent_locked = true;
          update_action_controls();
          append_log("intent sent");
          close_switch_modal();
          return;
        }
        post(room, { $: "forced_switch", targetIndex: entry.index });
        close_switch_modal();
      });
      switch_options.appendChild(button);
    }
  }
  switch_modal.classList.add("open");
}

function build_team_selection(): TeamSelection | null {
  if (selected.length !== 3) {
    show_warning("Select exactly 3 monsters before ready.");
    return null;
  }

  const monsters = selected.map((id) => {
    const config = get_config(id);
    return {
      id,
      moves: config.moves.slice(0, 4),
      passive: config.passive,
      stats: { ...config.stats }
    };
  });

  return { monsters, activeIndex: 0 };
}

function send_ready(next_ready: boolean): void {
  if (match_started) {
    return;
  }
  if (next_ready) {
    const team = build_team_selection();
    if (!team) {
      return;
    }
    post(room, { $: "ready", ready: true, team });
  } else {
    if (!slot) {
      return;
    }
    post(room, { $: "ready", ready: false });
  }
}

function update_ready_ui(): void {
  if (status_ready) {
    status_ready.textContent = is_ready ? "ready" : "not ready";
    status_ready.className = `status-pill ${is_ready ? "ok" : "off"}`;
  }
  ready_btn.textContent = is_ready ? "Unready" : "Ready";
  ready_btn.disabled = match_started;
  if (match_started) {
    prematch_hint.textContent = "Match started.";
    return;
  }
  let hint = "Select 3 monsters, configure, then Ready.";
  if (is_ready) {
    hint = "Waiting for opponent...";
  } else if (opponent_ready) {
    hint = "Opponent is ready. Configure and click Ready.";
  } else if (is_spectator && !slot) {
    hint = "Spectator mode. Select 3 monsters and click Ready to join.";
  }
  prematch_hint.textContent = hint;
  render_roster();
  render_tabs();
  render_config();
}

function update_opponent_ui(opponent_ready: boolean, opponent_name: string | null): void {
  if (!status_opponent) return;
  status_opponent.textContent = opponent_ready ? "ready" : opponent_name ? "waiting" : "offline";
  status_opponent.className = `status-pill ${opponent_ready ? "ok" : opponent_name ? "warn" : "off"}`;
}

function show_match_end(winner?: PlayerSlot): void {
  if (!match_end) return;
  const is_winner = winner && slot === winner;
  match_end_title.textContent = is_winner ? "Victory" : "Defeat";
  if (!winner) {
    match_end_title.textContent = "Match ended";
  }
  match_end_sub.textContent = winner ? `${winner} wins the match.` : "Match finished.";
  match_end.classList.add("open");
}

function handle_turn_start(data: { turn: number; deadline_at: number }): void {
  current_turn = data.turn;
  deadline_at = data.deadline_at;
  intent_locked = false;
  status_turn.textContent = `${current_turn}`;
  update_deadline();
  append_log(`turn ${current_turn} started`);
  close_switch_modal();
  if (!match_started) {
    match_started = true;
    prematch.style.display = "none";
    document.body.classList.remove("prematch-open");
  }
  update_action_controls();
}

function log_events(log: EventLog[]): void {
  for (const entry of log) {
    if (entry.type === "damage") {
      const data = entry.data as { slot?: PlayerSlot; damage?: number; target?: string } | undefined;
      const attacker_slot = data?.slot;
      const damage = data?.damage;
      if (attacker_slot && typeof damage === "number") {
        const attacker_id = latest_state?.players[attacker_slot]?.team[latest_state.players[attacker_slot].activeIndex]?.id;
        const attacker_name = monster_label(attacker_id);
        const defender_name = monster_label(data?.target);
        append_chat(`${attacker_name} deu ${damage} de dano em ${defender_name}`);
        continue;
      }
    }
    append_log(entry.summary);
  }
}

function update_panels(
  state: GameState,
  opts?: { skipMeta?: { player?: boolean; enemy?: boolean }; skipBar?: { player?: boolean; enemy?: boolean } }
): void {
  const viewer_slot = slot ?? (is_spectator ? "player1" : null);
  if (!viewer_slot) return;
  const me = state.players[viewer_slot];
  const opp = state.players[viewer_slot === "player1" ? "player2" : "player1"];
  const my_active = me.team[me.activeIndex];
  const opp_active = opp.team[opp.activeIndex];

  player_title.textContent = me.name || player_name;
  if (!opts?.skipMeta?.player) {
    player_meta.textContent = `Lv ${my_active.level} · HP ${my_active.hp}/${my_active.maxHp}`;
  }
  if (!opts?.skipBar?.player) {
    player_hp.style.width = `${Math.max(0, Math.min(1, my_active.hp / my_active.maxHp)) * 100}%`;
  }
  player_sprite.src = icon_path(my_active.id);
  player_sprite.alt = monster_label(my_active.id);
  player_sprite.title = monster_label(my_active.id);

  enemy_title.textContent = opp.name || "Opponent";
  if (!opts?.skipMeta?.enemy) {
    enemy_meta.textContent = `Lv ${opp_active.level} · HP ${opp_active.hp}/${opp_active.maxHp}`;
  }
  if (!opts?.skipBar?.enemy) {
    enemy_hp.style.width = `${Math.max(0, Math.min(1, opp_active.hp / opp_active.maxHp)) * 100}%`;
  }
  enemy_sprite.src = icon_path(opp_active.id);
  enemy_sprite.alt = monster_label(opp_active.id);
  enemy_sprite.title = monster_label(opp_active.id);
  update_bench(state, viewer_slot);
}

function animate_hp_text(
  side: "player" | "enemy",
  level: number,
  from: number,
  to: number,
  maxHp: number,
  delay: number = 180
): void {
  const target = side === "player" ? player_meta : enemy_meta;
  const start = performance.now();
  const duration = 260;
  const raf_key = side;
  if (hp_animation[raf_key]) {
    cancelAnimationFrame(hp_animation[raf_key]!);
  }
  const tick = (now: number) => {
    const elapsed = now - start;
    if (elapsed < delay) {
      hp_animation[raf_key] = requestAnimationFrame(tick);
      return;
    }
    const t = Math.min(1, (elapsed - delay) / duration);
    const value = Math.round(from + (to - from) * t);
    target.textContent = `Lv ${level} · HP ${value}/${maxHp}`;
    if (t < 1) {
      hp_animation[raf_key] = requestAnimationFrame(tick);
    }
  };
  hp_animation[raf_key] = requestAnimationFrame(tick);
}

function clear_animation_timers(): void {
  while (animation_timers.length) {
    const id = animation_timers.pop();
    if (id !== undefined) {
      clearTimeout(id);
    }
  }
  reset_sprite_fx();
}

function schedule_animation(fn: () => void, delay: number): void {
  const id = window.setTimeout(fn, delay);
  animation_timers.push(id);
}

function side_from_slot(viewer_slot: PlayerSlot | null, slot_id: PlayerSlot): "player" | "enemy" {
  if (!viewer_slot) {
    return slot_id === "player1" ? "player" : "enemy";
  }
  return slot_id === viewer_slot ? "player" : "enemy";
}

type VisualStep =
  | { kind: "damage"; attackerSide: "player" | "enemy"; defenderSide: "player" | "enemy"; from: number; to: number; level: number; maxHp: number }
  | { kind: "shield_on"; side: "player" | "enemy" }
  | { kind: "shield_hit"; attackerSide: "player" | "enemy"; defenderSide: "player" | "enemy" }
  | { kind: "heal"; side: "player" | "enemy" };

function build_visual_steps(prev_state: GameState, log: EventLog[], viewer_slot: PlayerSlot | null): VisualStep[] {
  const temp: GameState = JSON.parse(JSON.stringify(prev_state));
  const steps: VisualStep[] = [];
  for (const entry of log) {
    if (entry.type === "switch" || entry.type === "forced_switch") {
      const data = entry.data as { slot?: PlayerSlot; to?: number } | undefined;
      if (!data || !data.slot || typeof data.to !== "number") continue;
      temp.players[data.slot].activeIndex = data.to;
      continue;
    }
    if (entry.type === "protect") {
      const data = entry.data as { slot?: PlayerSlot } | undefined;
      if (!data?.slot) continue;
      const side = side_from_slot(viewer_slot, data.slot);
      steps.push({ kind: "shield_on", side });
      continue;
    }
    if (entry.type === "damage_blocked") {
      const data = entry.data as { slot?: PlayerSlot } | undefined;
      if (!data?.slot) continue;
      const defenderSide = side_from_slot(viewer_slot, data.slot);
      const attackerSide = defenderSide === "player" ? "enemy" : "player";
      steps.push({ kind: "shield_hit", attackerSide, defenderSide });
      continue;
    }
    if (entry.type === "passive_heal") {
      const data = entry.data as { slot?: PlayerSlot } | undefined;
      if (!data?.slot) continue;
      const side = side_from_slot(viewer_slot, data.slot);
      steps.push({ kind: "heal", side });
      continue;
    }
    if (entry.type !== "damage" && entry.type !== "recoil") continue;
    const payload = entry.data as { slot?: PlayerSlot; damage?: number } | undefined;
    if (!payload || typeof payload.damage !== "number" || payload.damage <= 0 || !payload.slot) {
      continue;
    }
    const defender_slot = entry.type === "recoil" ? payload.slot : payload.slot === "player1" ? "player2" : "player1";
    const defender_player = temp.players[defender_slot];
    const defender = defender_player.team[defender_player.activeIndex];
    const from = defender.hp;
    const to = Math.max(0, from - payload.damage);
    defender.hp = to;
    const defenderSide = side_from_slot(viewer_slot, defender_slot);
    const attackerSide = entry.type === "recoil" ? defenderSide : defenderSide === "player" ? "enemy" : "player";
    steps.push({
      kind: "damage",
      attackerSide,
      defenderSide,
      from,
      to,
      level: defender.level,
      maxHp: defender.maxHp
    });
  }
  return steps;
}

function animate_hp_bar(bar: HTMLSpanElement, from: number, to: number): void {
  bar.classList.remove("hp-anim");
  bar.style.transition = "none";
  bar.style.width = `${from}%`;
  void bar.offsetWidth;
  bar.style.transition = "";
  bar.classList.add("hp-anim");
  bar.style.width = `${to}%`;
  window.setTimeout(() => {
    bar.classList.remove("hp-anim");
  }, 450);
}

function sprite_wrap(side: "player" | "enemy"): HTMLDivElement {
  return side === "player" ? player_sprite_wrap : enemy_sprite_wrap;
}

function reset_sprite_fx(): void {
  [player_sprite_wrap, enemy_sprite_wrap].forEach((wrap) => {
    sprite_fx_classes.forEach((fx) => wrap.classList.remove(fx));
    wrap.style.transform = "";
  });
}

function trigger_class(el: HTMLElement, className: string, duration: number): void {
  el.classList.remove(className);
  void el.offsetWidth;
  el.classList.add(className);
  window.setTimeout(() => {
    el.classList.remove(className);
  }, duration);
}

function handle_state(data: { state: GameState; log: EventLog[] }): void {
  const prev_state = latest_state;
  clear_animation_timers();
  const viewer_slot = slot ?? (is_spectator ? "player1" : null);
  const steps = prev_state ? build_visual_steps(prev_state, data.log, viewer_slot) : [];
  const hit_sides = new Set<"player" | "enemy">(
    steps.filter((step) => step.kind === "damage").map((step) => step.defenderSide)
  );
  latest_state = data.state;
  if (!match_started && data.state.status === "running") {
    match_started = true;
    prematch.style.display = "none";
    document.body.classList.remove("prematch-open");
  }
  update_panels(data.state, {
    skipMeta: {
      player: hit_sides.has("player"),
      enemy: hit_sides.has("enemy")
    },
    skipBar: {
      player: hit_sides.has("player"),
      enemy: hit_sides.has("enemy")
    }
  });
  if (steps.length > 0) {
    let cursor = 0;
    for (const step of steps) {
      const duration =
        step.kind === "damage" ? 650 : step.kind === "shield_hit" ? 420 : step.kind === "shield_on" ? 360 : 320;
      schedule_animation(() => {
        if (step.kind === "damage") {
          const attacker_wrap = sprite_wrap(step.attackerSide);
          const defender_wrap = sprite_wrap(step.defenderSide);
          trigger_class(attacker_wrap, "jump", 300);
          trigger_class(defender_wrap, "hit", 420);
          const bar = step.defenderSide === "player" ? player_hp : enemy_hp;
          const from_percent = Math.max(0, Math.min(1, step.from / step.maxHp)) * 100;
          const to_percent = Math.max(0, Math.min(1, step.to / step.maxHp)) * 100;
          animate_hp_bar(bar, from_percent, to_percent);
          animate_hp_text(step.defenderSide, step.level, step.from, step.to, step.maxHp, 180);
          return;
        }
        if (step.kind === "shield_on") {
          const wrap = sprite_wrap(step.side);
          trigger_class(wrap, "shield-on", 400);
          return;
        }
        if (step.kind === "shield_hit") {
          const attacker_wrap = sprite_wrap(step.attackerSide);
          const defender_wrap = sprite_wrap(step.defenderSide);
          trigger_class(attacker_wrap, "jump", 300);
          trigger_class(defender_wrap, "shield-hit", 450);
          return;
        }
        if (step.kind === "heal") {
          const wrap = sprite_wrap(step.side);
          trigger_class(wrap, "heal", 360);
        }
      }, cursor);
      cursor += duration;
    }
    schedule_animation(() => {
      update_panels(data.state);
    }, cursor + 50);
  } else {
    update_panels(data.state);
  }
  close_switch_modal();
  if (data.log.length) {
    log_events(data.log);
  }
  update_action_controls();
  if (data.state.status === "ended") {
    show_match_end(data.state.winner);
  }
  if (slot && data.state.pendingSwitch?.[slot] && !switch_modal.classList.contains("open")) {
    open_switch_modal("forced");
  }
}

function handle_post(message: any): void {
  const data: RoomPost = message.data;
  switch (data.$) {
    case "assign":
      slot = data.slot;
      is_spectator = false;
      if (status_slot) status_slot.textContent = data.slot;
      if (status_conn) status_conn.textContent = "synced";
      player_meta.textContent = `Slot ${data.slot}`;
      if (data.token) {
        localStorage.setItem(token_key, data.token);
        stored_token = data.token;
      }
      append_log(`assigned ${data.slot}`);
      append_chat(`${data.name} assigned to ${data.slot}`);
      return;
    case "ready_state": {
      const previous = last_ready_snapshot ?? { player1: false, player2: false };
      last_ready_snapshot = { ...data.ready };
      participants = {
        players: { ...data.names },
        spectators: participants ? participants.spectators.slice() : []
      };
      if (Array.isArray(data.order)) {
        ready_order = data.order.slice();
      } else {
        PLAYER_SLOTS.forEach((slot_id) => {
          const is_ready_now = data.ready[slot_id];
          const idx = ready_order.indexOf(slot_id);
          if (is_ready_now && idx === -1) {
            ready_order.push(slot_id);
          } else if (!is_ready_now && idx !== -1) {
            ready_order.splice(idx, 1);
          }
        });
      }
      PLAYER_SLOTS.forEach((slot_id) => {
        if (previous[slot_id] !== data.ready[slot_id]) {
          const name = data.names[slot_id];
          if (name) {
            append_chat(data.ready[slot_id] ? `${name} is ready` : `${name} is waiting`);
          }
        }
      });
      if (slot) {
        const opponent_slot = slot === "player1" ? "player2" : "player1";
        is_ready = data.ready[slot];
        opponent_ready = data.ready[opponent_slot];
        opponent_name = data.names[opponent_slot];
        update_opponent_ui(opponent_ready, opponent_name);
      }
      update_ready_ui();
      render_participants();
      return;
    }
    case "turn_start":
      handle_turn_start(data);
      return;
    case "intent_locked":
      append_log(`${data.slot} locked intent for turn ${data.turn}`);
      if (slot && data.slot === slot) {
        intent_locked = true;
        update_action_controls();
      }
      return;
    case "state":
      handle_state(data);
      return;
    case "surrender":
      append_log(`surrender: ${data.loser}`);
      append_chat(`${data.loser} surrendered`);
      return;
    case "error":
      append_log(`error: ${data.message}`);
      show_warning(data.message);
      append_chat(`error: ${data.message}`);
      return;
    case "join":
      append_log(`join: ${data.name}`);
      append_chat(`${data.name} joined the room`);
      return;
    case "spectator":
      is_spectator = true;
      if (status_slot) status_slot.textContent = "spectator";
      update_ready_ui();
      return;
    case "chat":
      append_chat(`${data.from}: ${data.message}`);
      return;
    case "participants":
      participants = { players: data.players, spectators: data.spectators.slice() };
      render_participants();
      return;
    case "intent":
      append_log(`intent received for turn ${data.turn}`);
      return;
  }
}

move_buttons.forEach((btn, index) => {
  btn.addEventListener("click", () => {
    send_move_intent(index);
  });
});

if (switch_btn) {
  switch_btn.addEventListener("click", () => {
    open_switch_modal(has_pending_switch() ? "forced" : "intent");
  });
}

surrender_btn.addEventListener("click", () => {
  send_surrender();
});

switch_close.addEventListener("click", () => {
  close_switch_modal();
});

switch_modal.addEventListener("click", (event) => {
  if (event.target === switch_modal) {
    close_switch_modal();
  }
});

ready_btn.addEventListener("click", () => {
  if (match_started) {
    return;
  }
  if (is_ready) {
    send_ready(false);
  } else {
    send_ready(true);
  }
});

match_end_btn.addEventListener("click", () => {
  window.location.reload();
});

slot_active.addEventListener("click", () => {
  set_edit_target(0);
});
slot_bench_a.addEventListener("click", () => {
  set_edit_target(1);
});
slot_bench_b.addEventListener("click", () => {
  set_edit_target(2);
});

player_bench_slots.forEach((slot_el) => {
  slot_el.btn.addEventListener("click", () => {
    const index = Number(slot_el.btn.dataset.index);
    if (!Number.isFinite(index)) return;
    send_switch_intent(index);
  });
});

setInterval(update_deadline, 1000);

setInterval(() => {
  const rtt = ping();
  if (isFinite(rtt)) {
    status_ping.textContent = `${Math.round(rtt)} ms`;
  } else {
    status_ping.textContent = "--";
  }
}, 1000);

load_team_selection();
render_roster();
render_tabs();
render_config();
update_roster_count();
update_slots();
update_action_controls();

on_sync(() => {
  if (status_conn) status_conn.textContent = "synced";
  watch(room, handle_post);
  load(room, 0);
  post(room, { $: "join", name: player_name, token: stored_token });
  setup_chat_input(chat_input, chat_send);
});
