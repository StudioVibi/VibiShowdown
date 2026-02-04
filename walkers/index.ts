import { gen_name, load, on_sync, ping, post, watch } from "../src/client.ts";
import type {
  EventLog,
  GameState,
  PlayerIntent,
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

const MOVE_OPTIONS = ["basic_attack", "protect", "none"];
const PASSIVE_OPTIONS = ["none", "regen_5pct"];

const MOVE_LABELS: Record<string, string> = {
  basic_attack: "Basic Attack",
  protect: "Protect",
  none: "none"
};

const PASSIVE_LABELS: Record<string, string> = {
  none: "none",
  regen_5pct: "Regen 5%"
};

const roster: MonsterSpec[] = [
  {
    id: "babydragon",
    name: "Baby Dragon",
    role: "Brawler",
    stats: { level: 10, maxHp: 48, attack: 14, defense: 9, speed: 8 },
    possibleMoves: MOVE_OPTIONS,
    possiblePassives: PASSIVE_OPTIONS,
    defaultMoves: ["basic_attack", "protect", "none", "none"],
    defaultPassive: "none"
  },
  {
    id: "croni",
    name: "Croni",
    role: "Mystic",
    stats: { level: 10, maxHp: 36, attack: 9, defense: 8, speed: 14 },
    possibleMoves: MOVE_OPTIONS,
    possiblePassives: PASSIVE_OPTIONS,
    defaultMoves: ["basic_attack", "none", "none", "none"],
    defaultPassive: "regen_5pct"
  },
  {
    id: "harpy",
    name: "Harpy",
    role: "Striker",
    stats: { level: 10, maxHp: 34, attack: 12, defense: 7, speed: 16 },
    possibleMoves: MOVE_OPTIONS,
    possiblePassives: PASSIVE_OPTIONS,
    defaultMoves: ["basic_attack", "protect", "none", "none"],
    defaultPassive: "none"
  },
  {
    id: "hoof",
    name: "Hoof",
    role: "Tank",
    stats: { level: 10, maxHp: 60, attack: 8, defense: 16, speed: 6 },
    possibleMoves: MOVE_OPTIONS,
    possiblePassives: PASSIVE_OPTIONS,
    defaultMoves: ["basic_attack", "protect", "none", "none"],
    defaultPassive: "regen_5pct"
  },
  {
    id: "knight",
    name: "Knight",
    role: "Guardian",
    stats: { level: 10, maxHp: 50, attack: 11, defense: 14, speed: 8 },
    possibleMoves: MOVE_OPTIONS,
    possiblePassives: PASSIVE_OPTIONS,
    defaultMoves: ["basic_attack", "protect", "none", "none"],
    defaultPassive: "none"
  },
  {
    id: "miren",
    name: "Miren",
    role: "Mage",
    stats: { level: 10, maxHp: 32, attack: 16, defense: 7, speed: 12 },
    possibleMoves: MOVE_OPTIONS,
    possiblePassives: PASSIVE_OPTIONS,
    defaultMoves: ["basic_attack", "none", "none", "none"],
    defaultPassive: "regen_5pct"
  },
  {
    id: "panda",
    name: "Panda",
    role: "Bruiser",
    stats: { level: 10, maxHp: 54, attack: 13, defense: 12, speed: 7 },
    possibleMoves: MOVE_OPTIONS,
    possiblePassives: PASSIVE_OPTIONS,
    defaultMoves: ["basic_attack", "protect", "none", "none"],
    defaultPassive: "none"
  },
  {
    id: "priestess",
    name: "Priestess",
    role: "Support",
    stats: { level: 10, maxHp: 38, attack: 9, defense: 10, speed: 11 },
    possibleMoves: MOVE_OPTIONS,
    possiblePassives: PASSIVE_OPTIONS,
    defaultMoves: ["basic_attack", "none", "none", "none"],
    defaultPassive: "regen_5pct"
  },
  {
    id: "valkyria",
    name: "Valkyria",
    role: "Vanguard",
    stats: { level: 10, maxHp: 44, attack: 14, defense: 10, speed: 13 },
    possibleMoves: MOVE_OPTIONS,
    possiblePassives: PASSIVE_OPTIONS,
    defaultMoves: ["basic_attack", "protect", "none", "none"],
    defaultPassive: "none"
  },
  {
    id: "vulcasa",
    name: "Vulcasa",
    role: "Pyro",
    stats: { level: 10, maxHp: 40, attack: 15, defense: 8, speed: 10 },
    possibleMoves: MOVE_OPTIONS,
    possiblePassives: PASSIVE_OPTIONS,
    defaultMoves: ["basic_attack", "protect", "none", "none"],
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
const status_slot = document.getElementById("status-slot")!;
const status_conn = document.getElementById("status-conn")!;
const status_ping = document.getElementById("status-ping")!;
const status_turn = document.getElementById("status-turn")!;
const status_deadline = document.getElementById("status-deadline")!;
const status_ready = document.getElementById("status-ready")!;
const status_opponent = document.getElementById("status-opponent")!;
const log_list = document.getElementById("log-list")!;

const player_title = document.getElementById("player-name")!;
const player_meta = document.getElementById("player-meta")!;
const enemy_title = document.getElementById("enemy-name")!;
const enemy_meta = document.getElementById("enemy-meta")!;
const enemy_hp = document.getElementById("enemy-hp")!;
const player_hp = document.getElementById("player-hp")!;
const player_sprite = document.getElementById("player-sprite") as HTMLImageElement;
const enemy_sprite = document.getElementById("enemy-sprite") as HTMLImageElement;

const prematch = document.getElementById("prematch")!;
const prematch_hint = document.getElementById("prematch-hint")!;
const ready_btn = document.getElementById("ready-btn")!;
const intent_btn = document.getElementById("intent-btn")!;

const roster_count = document.getElementById("roster-count")!;
const slot_active = document.getElementById("slot-active")!;
const slot_bench_a = document.getElementById("slot-bench-a")!;
const slot_bench_b = document.getElementById("slot-bench-b")!;
const monster_tabs = document.getElementById("monster-tabs")!;
const moves_grid = document.getElementById("moves-grid")!;
const passive_grid = document.getElementById("passive-grid")!;
const stats_grid = document.getElementById("stats-grid")!;
const config_warning = document.getElementById("config-warning")!;

const action_select = document.getElementById("action-select") as HTMLSelectElement;
const move_select = document.getElementById("move-select") as HTMLSelectElement;
const switch_select = document.getElementById("switch-select") as HTMLSelectElement;

status_room.textContent = room;
status_name.textContent = player_name;
player_title.textContent = player_name;
enemy_title.textContent = "Opponent";

let current_turn = 0;
let deadline_at = 0;
let slot: PlayerSlot | null = null;
let is_ready = false;
let match_started = false;
let latest_state: GameState | null = null;
let opponent_ready = false;
let opponent_name: string | null = null;

const selected: string[] = [];
let active_tab: string | null = null;

function icon_path(id: string): string {
  return `/icons/unit_${id}.png`;
}

function append_log(line: string): void {
  const p = document.createElement("p");
  p.textContent = line;
  log_list.appendChild(p);
  log_list.scrollTop = log_list.scrollHeight;
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

function load_profile(): Profile {
  try {
    const raw = localStorage.getItem(profile_key);
    if (!raw) {
      return { monsters: {} };
    }
    const parsed = JSON.parse(raw);
    if (parsed && typeof parsed === "object" && parsed.monsters) {
      return { monsters: parsed.monsters as Record<string, MonsterConfig> };
    }
  } catch {}
  return { monsters: {} };
}

const profile = load_profile();

function save_profile(): void {
  try {
    localStorage.setItem(profile_key, JSON.stringify(profile));
  } catch {}
}

function load_team_selection(): void {
  try {
    const raw = localStorage.getItem(team_key);
    if (!raw) return;
    const parsed = JSON.parse(raw);
    if (parsed && Array.isArray(parsed.selected)) {
      selected.splice(0, selected.length, ...parsed.selected.filter((id: string) => roster_by_id.has(id)));
    }
  } catch {}
}

function save_team_selection(): void {
  try {
    localStorage.setItem(team_key, JSON.stringify({ selected: selected.slice() }));
  } catch {}
}

function clone_stats(stats: Stats): Stats {
  return { level: stats.level, maxHp: stats.maxHp, attack: stats.attack, defense: stats.defense, speed: stats.speed };
}

function coerce_config(spec: MonsterSpec, value?: MonsterConfig): MonsterConfig {
  const base: MonsterConfig = {
    moves: spec.defaultMoves.slice(0, 4),
    passive: spec.defaultPassive,
    stats: clone_stats(spec.stats)
  };

  if (!value) {
    return base;
  }

  const moves = Array.isArray(value.moves) ? value.moves.slice(0, 4) : base.moves.slice();
  while (moves.length < 4) {
    moves.push("none");
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

function update_slots(): void {
  const name_for = (id?: string): string => {
    if (!id) return "empty";
    return roster_by_id.get(id)?.name ?? id;
  };
  slot_active.textContent = name_for(selected[0]);
  slot_bench_a.textContent = name_for(selected[1]);
  slot_bench_b.textContent = name_for(selected[2]);
}

function render_tabs(): void {
  monster_tabs.innerHTML = "";
  if (selected.length === 0) {
    active_tab = null;
    render_config();
    return;
  }

  if (!active_tab || !selected.includes(active_tab)) {
    active_tab = selected[0];
  }

  for (const id of selected) {
    const spec = roster_by_id.get(id);
    const button = document.createElement("button");
    button.className = `tab${id === active_tab ? " active" : ""}`;
    const label = spec ? spec.name : id;
    const is_active = id === selected[0];
    button.textContent = is_active ? `${label} ★` : label;
    button.disabled = is_ready && !match_started;
    button.addEventListener("click", () => {
      if (is_ready && !match_started) {
        return;
      }
      active_tab = id;
      render_tabs();
      render_config();
    });
    monster_tabs.appendChild(button);
  }
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

function set_active_index(index: number): void {
  if (index <= 0 || index >= selected.length) {
    return;
  }
  const [chosen] = selected.splice(index, 1);
  selected.unshift(chosen);
  save_team_selection();
  update_slots();
  render_tabs();
  render_config();
  update_action_controls();
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
      <div class="sprite" style="width:44px;height:44px;">
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

function update_action_controls(): void {
  const action = action_select.value;
  const has_team = selected.length === 3;
  action_select.disabled = !match_started;
  move_select.disabled = !match_started || action !== "use_move";
  switch_select.disabled = !match_started || action !== "switch";

  move_select.innerHTML = "";
  switch_select.innerHTML = "";

  if (!has_team) {
    return;
  }

  const active_id = selected[0];
  const config = get_config(active_id);
  let protect_on_cooldown = false;
  if (latest_state && slot) {
    const active_state = latest_state.players[slot].team[latest_state.players[slot].activeIndex];
    protect_on_cooldown = active_state.protectCooldownTurns > 0;
  }
  config.moves.forEach((move, index) => {
    const option = document.createElement("option");
    option.value = `${index}`;
    option.textContent = `${index + 1}. ${MOVE_LABELS[move] || move}`;
    if (move === "protect" && protect_on_cooldown) {
      option.disabled = true;
      option.textContent = `${index + 1}. Protect (cooldown)`;
    }
    move_select.appendChild(option);
  });

  if (protect_on_cooldown && move_select.selectedOptions.length > 0) {
    const selected_option = move_select.selectedOptions[0];
    if (selected_option.disabled) {
      const next_available = Array.from(move_select.options).find((opt) => !opt.disabled);
      if (next_available) {
        move_select.value = next_available.value;
      }
    }
  }

  if (selected[1]) {
    const option = document.createElement("option");
    option.value = "1";
    option.textContent = roster_by_id.get(selected[1])?.name || selected[1];
    switch_select.appendChild(option);
  }
  if (selected[2]) {
    const option = document.createElement("option");
    option.value = "2";
    option.textContent = roster_by_id.get(selected[2])?.name || selected[2];
    switch_select.appendChild(option);
  }
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
    post(room, { $: "ready", ready: false });
  }
}

function update_ready_ui(): void {
  status_ready.textContent = is_ready ? "ready" : "not ready";
  ready_btn.textContent = is_ready ? "Unready" : "Ready";
  if (match_started) {
    prematch_hint.textContent = "Match started.";
    return;
  }
  if (is_ready) {
    prematch_hint.textContent = "Waiting for opponent...";
  } else if (opponent_ready) {
    prematch_hint.textContent = "Opponent is ready. Configure and click Ready.";
  } else {
    prematch_hint.textContent = "Select 3 monsters, configure, then Ready.";
  }
  render_roster();
  render_tabs();
  render_config();
}

function update_opponent_ui(opponent_ready: boolean, opponent_name: string | null): void {
  status_opponent.textContent = opponent_ready ? "ready" : opponent_name ? "waiting" : "offline";
}

function handle_turn_start(data: { turn: number; deadline_at: number }): void {
  current_turn = data.turn;
  deadline_at = data.deadline_at;
  status_turn.textContent = `${current_turn}`;
  update_deadline();
  append_log(`turn ${current_turn} started`);
  if (!match_started) {
    match_started = true;
    prematch.style.display = "none";
    update_action_controls();
  }
}

function log_events(log: EventLog[]): void {
  for (const entry of log) {
    append_log(entry.summary);
  }
}

function update_panels(state: GameState): void {
  if (!slot) return;
  const me = state.players[slot];
  const opp = state.players[slot === "player1" ? "player2" : "player1"];
  const my_active = me.team[me.activeIndex];
  const opp_active = opp.team[opp.activeIndex];

  player_title.textContent = me.name || player_name;
  player_meta.textContent = `Lv ${my_active.level} · HP ${my_active.hp}/${my_active.maxHp}`;
  player_hp.style.width = `${Math.max(0, Math.min(1, my_active.hp / my_active.maxHp)) * 100}%`;
  player_sprite.src = icon_path(my_active.id);

  enemy_title.textContent = opp.name || "Opponent";
  enemy_meta.textContent = `Lv ${opp_active.level} · HP ${opp_active.hp}/${opp_active.maxHp}`;
  enemy_hp.style.width = `${Math.max(0, Math.min(1, opp_active.hp / opp_active.maxHp)) * 100}%`;
  enemy_sprite.src = icon_path(opp_active.id);
}

function handle_state(data: { state: GameState; log: EventLog[] }): void {
  latest_state = data.state;
  update_panels(data.state);
  if (data.log.length) {
    log_events(data.log);
  }
  update_action_controls();
}

function handle_post(message: any): void {
  const data: RoomPost = message.data;
  switch (data.$) {
    case "assign":
      slot = data.slot;
      status_slot.textContent = data.slot;
      status_conn.textContent = "synced";
      player_meta.textContent = `Slot ${data.slot}`;
      if (data.token) {
        localStorage.setItem(token_key, data.token);
        stored_token = data.token;
      }
      append_log(`assigned ${data.slot}`);
      return;
    case "ready_state": {
      if (!slot) return;
      is_ready = data.ready[slot];
      const opponent_slot = slot === "player1" ? "player2" : "player1";
      opponent_ready = data.ready[opponent_slot];
      opponent_name = data.names[opponent_slot];
      update_ready_ui();
      update_opponent_ui(opponent_ready, opponent_name);
      return;
    }
    case "turn_start":
      handle_turn_start(data);
      return;
    case "intent_locked":
      append_log(`${data.slot} locked intent for turn ${data.turn}`);
      return;
    case "state":
      handle_state(data);
      return;
    case "forfeit":
      append_log(`forfeit: ${data.losers.join(", ")}`);
      return;
    case "error":
      append_log(`error: ${data.message}`);
      show_warning(data.message);
      return;
    case "join":
      append_log(`join: ${data.name}`);
      return;
    case "intent":
      append_log(`intent received for turn ${data.turn}`);
      return;
  }
}

intent_btn.addEventListener("click", () => {
  if (current_turn <= 0) {
    append_log("turn not active yet");
    return;
  }
  if (!slot) {
    append_log("slot not assigned");
    return;
  }
  const action = action_select.value;
  let intent: PlayerIntent;
  if (action === "switch") {
    const targetIndex = Number(switch_select.value);
    intent = { action: "switch", targetIndex };
  } else {
    const moveIndex = Number(move_select.value);
    intent = { action: "use_move", moveIndex };
  }
  post(room, { $: "intent", turn: current_turn, intent });
  append_log("intent sent");
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

slot_active.addEventListener("click", () => {
  if (is_ready && !match_started) return;
  set_active_index(0);
});
slot_bench_a.addEventListener("click", () => {
  if (is_ready && !match_started) return;
  set_active_index(1);
});
slot_bench_b.addEventListener("click", () => {
  if (is_ready && !match_started) return;
  set_active_index(2);
});

action_select.addEventListener("change", () => {
  update_action_controls();
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
  status_conn.textContent = "synced";
  watch(room, handle_post);
  load(room, 0);
  post(room, { $: "join", name: player_name, token: stored_token });
});
