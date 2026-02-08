// src/config.ts
var REMOTE_WSS = "wss://game.vibistudiotest.site";
function has_window() {
  return typeof window !== "undefined" && typeof window.location !== "undefined";
}
function from_global_override() {
  if (!has_window())
    return;
  const global_any = window;
  if (typeof global_any.__VIBI_WS_URL__ === "string") {
    return global_any.__VIBI_WS_URL__;
  }
  return;
}
function normalize(value) {
  if (value.startsWith("wss://") || value.startsWith("ws://")) {
    return value;
  }
  if (value.startsWith("https://")) {
    return `wss://${value.slice("https://".length)}`;
  }
  if (value.startsWith("http://")) {
    return `ws://${value.slice("http://".length)}`;
  }
  const lower = value.toLowerCase();
  const is_local = lower.startsWith("localhost") || lower.startsWith("127.0.0.1") || lower.startsWith("0.0.0.0");
  return `${is_local ? "ws" : "wss"}://${value}`;
}
function from_query_param() {
  if (!has_window())
    return;
  try {
    const url = new URL(window.location.href);
    const value = url.searchParams.get("ws");
    if (value) {
      return normalize(value);
    }
  } catch {}
  return;
}
function detect_url() {
  const manual = from_global_override() ?? from_query_param();
  if (manual) {
    return manual;
  }
  if (has_window()) {
    try {
      const origin = window.location.origin;
      if (origin && origin !== "null") {
        return normalize(origin);
      }
    } catch {}
  }
  return REMOTE_WSS;
}
var WS_URL = detect_url();

// src/helpers.ts
function now() {
  return Math.floor(Date.now());
}
function random_id(length, alphabet, source) {
  const bytes = new Uint8Array(length);
  if (source) {
    source.fillBytes(bytes);
  } else {
    for (let i = 0;i < length; i++) {
      bytes[i] = Math.floor(Math.random() * 256);
    }
  }
  let out = "";
  for (let i = 0;i < length; i++) {
    out += alphabet[bytes[i] % alphabet.length];
  }
  return out;
}

// src/client.ts
var time_sync = {
  clock_offset: Infinity,
  lowest_ping: Infinity,
  request_sent_at: 0,
  last_ping: Infinity
};
var ws = new WebSocket(WS_URL);
var room_watchers = new Map;
var is_synced = false;
var sync_listeners = [];
function server_time() {
  if (!isFinite(time_sync.clock_offset)) {
    throw new Error("server_time() called before initial sync");
  }
  return Math.floor(now() + time_sync.clock_offset);
}
function ensure_open() {
  if (ws.readyState !== WebSocket.OPEN) {
    throw new Error("WebSocket not open");
  }
}
function send(obj) {
  ensure_open();
  ws.send(JSON.stringify(obj));
}
function register_handler(room, handler) {
  if (!handler) {
    return;
  }
  if (room_watchers.has(room)) {
    throw new Error(`Handler already registered for room: ${room}`);
  }
  room_watchers.set(room, handler);
}
ws.addEventListener("open", () => {
  console.log(`[WS] Connected to ${WS_URL}`);
  time_sync.request_sent_at = now();
  ws.send(JSON.stringify({ $: "get_time" }));
  setInterval(() => {
    time_sync.request_sent_at = now();
    ws.send(JSON.stringify({ $: "get_time" }));
  }, 2000);
});
ws.addEventListener("message", (event) => {
  const msg = JSON.parse(event.data);
  switch (msg.$) {
    case "info_time": {
      const t = now();
      const ping = t - time_sync.request_sent_at;
      time_sync.last_ping = ping;
      if (ping < time_sync.lowest_ping) {
        const local_avg = Math.floor((time_sync.request_sent_at + t) / 2);
        time_sync.clock_offset = msg.time - local_avg;
        time_sync.lowest_ping = ping;
      }
      if (!is_synced) {
        is_synced = true;
        for (const cb of sync_listeners) {
          cb();
        }
        sync_listeners.length = 0;
      }
      break;
    }
    case "info_post": {
      const handler = room_watchers.get(msg.room);
      if (handler) {
        handler(msg);
      }
      break;
    }
  }
});
function gen_name() {
  const alphabet = "_abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789-";
  const can_crypto = typeof crypto !== "undefined" && typeof crypto.getRandomValues === "function";
  const source = can_crypto ? { fillBytes: (bytes) => crypto.getRandomValues(bytes) } : undefined;
  return random_id(8, alphabet, source);
}
function post(room, data) {
  const name = gen_name();
  send({ $: "post", room, time: server_time(), name, data });
  return name;
}
function load(room, from = 0, handler) {
  register_handler(room, handler);
  send({ $: "load", room, from });
}
function watch(room, handler) {
  register_handler(room, handler);
  send({ $: "watch", room });
}
function on_sync(callback) {
  if (is_synced) {
    callback();
    return;
  }
  sync_listeners.push(callback);
}
function ping() {
  return time_sync.last_ping;
}

// vibishowdown/index.ts
var PLAYER_SLOTS = ["player1", "player2"];
var MOVE_OPTIONS = ["basic_attack", "return", "double_edge", "seismic_toss", "protect", "none"];
var PASSIVE_OPTIONS = ["none", "regen_5pct"];
var MOVE_LABELS = {
  basic_attack: "Basic Attack",
  return: "Return",
  double_edge: "Double-Edge",
  seismic_toss: "Seismic Toss",
  protect: "Protect",
  none: "none"
};
var PASSIVE_LABELS = {
  none: "none",
  regen_5pct: "Regen 3%"
};
var roster = [
  {
    id: "babydragon",
    name: "Return Tester",
    role: "Return Attacker",
    stats: { level: 7, maxHp: 100, attack: 100, defense: 10, speed: 20 },
    possibleMoves: ["return", "none"],
    possiblePassives: ["none"],
    defaultMoves: ["return", "none", "none", "none"],
    defaultPassive: "none"
  },
  {
    id: "croni",
    name: "Return Dummy",
    role: "Return Defender",
    stats: { level: 7, maxHp: 100, attack: 10, defense: 10, speed: 10 },
    possibleMoves: ["none"],
    possiblePassives: ["none"],
    defaultMoves: ["none", "none", "none", "none"],
    defaultPassive: "none"
  },
  {
    id: "harpy",
    name: "Double-Edge Tester",
    role: "Double-Edge Attacker",
    stats: { level: 7, maxHp: 100, attack: 100, defense: 10, speed: 20 },
    possibleMoves: ["double_edge", "none"],
    possiblePassives: ["none"],
    defaultMoves: ["double_edge", "none", "none", "none"],
    defaultPassive: "none"
  },
  {
    id: "hoof",
    name: "Double-Edge Dummy",
    role: "Double-Edge Defender",
    stats: { level: 7, maxHp: 100, attack: 10, defense: 10, speed: 10 },
    possibleMoves: ["none"],
    possiblePassives: ["none"],
    defaultMoves: ["none", "none", "none", "none"],
    defaultPassive: "none"
  },
  {
    id: "panda",
    name: "Seismic Toss Tester",
    role: "Seismic Toss Attacker",
    stats: { level: 7, maxHp: 100, attack: 100, defense: 10, speed: 20 },
    possibleMoves: ["seismic_toss", "none"],
    possiblePassives: ["none"],
    defaultMoves: ["seismic_toss", "none", "none", "none"],
    defaultPassive: "none"
  },
  {
    id: "miren",
    name: "Seismic Toss Dummy",
    role: "Seismic Toss Defender",
    stats: { level: 7, maxHp: 100, attack: 10, defense: 10, speed: 10 },
    possibleMoves: ["none"],
    possiblePassives: ["none"],
    defaultMoves: ["none", "none", "none", "none"],
    defaultPassive: "none"
  }
];
var roster_by_id = new Map(roster.map((entry) => [entry.id, entry]));
var room = prompt("Room name?") || gen_name();
var player_name = prompt("Your name?") || gen_name();
var token_key = `vibi_showdown_token:${room}:${player_name}`;
var stored_token = localStorage.getItem(token_key) || undefined;
var profile_key = `vibi_showdown_profile:${player_name}`;
var team_key = `vibi_showdown_team:${room}:${player_name}`;
var status_room = document.getElementById("status-room");
var status_name = document.getElementById("status-name");
var status_slot = document.getElementById("status-slot");
var status_conn = document.getElementById("status-conn");
var status_ping = document.getElementById("status-ping");
var status_turn = document.getElementById("status-turn");
var status_deadline = document.getElementById("status-deadline");
var status_ready = document.getElementById("status-ready");
var status_opponent = document.getElementById("status-opponent");
var log_list = document.getElementById("log-list");
var chat_messages = document.getElementById("chat-messages");
var chat_input = document.getElementById("chat-input");
var chat_send = document.getElementById("chat-send");
var participants_list = document.getElementById("participants-list");
var player_title = document.getElementById("player-name");
var player_meta = document.getElementById("player-meta");
var enemy_title = document.getElementById("enemy-name");
var enemy_meta = document.getElementById("enemy-meta");
var enemy_hp = document.getElementById("enemy-hp");
var player_hp = document.getElementById("player-hp");
var player_sprite = document.getElementById("player-sprite");
var enemy_sprite = document.getElementById("enemy-sprite");
var player_sprite_wrap = document.getElementById("player-sprite-wrap");
var enemy_sprite_wrap = document.getElementById("enemy-sprite-wrap");
var prematch = document.getElementById("prematch");
var prematch_hint = document.getElementById("prematch-hint");
var ready_btn = document.getElementById("ready-btn");
var move_buttons = [
  document.getElementById("move-btn-0"),
  document.getElementById("move-btn-1"),
  document.getElementById("move-btn-2"),
  document.getElementById("move-btn-3")
];
var switch_btn = document.getElementById("switch-btn");
var surrender_btn = document.getElementById("surrender-btn");
var switch_modal = document.getElementById("switch-modal");
var switch_options = document.getElementById("switch-options");
var switch_close = document.getElementById("switch-close");
var roster_count = document.getElementById("roster-count");
var slot_active = document.getElementById("slot-active");
var slot_bench_a = document.getElementById("slot-bench-a");
var slot_bench_b = document.getElementById("slot-bench-b");
var monster_tabs = document.getElementById("monster-tabs");
var moves_grid = document.getElementById("moves-grid");
var passive_grid = document.getElementById("passive-grid");
var stats_grid = document.getElementById("stats-grid");
var config_warning = document.getElementById("config-warning");
var match_end = document.getElementById("match-end");
var match_end_title = document.getElementById("match-end-title");
var match_end_sub = document.getElementById("match-end-sub");
var match_end_btn = document.getElementById("match-end-btn");
status_room.textContent = room;
status_name.textContent = player_name;
player_title.textContent = player_name;
enemy_title.textContent = "Opponent";
document.body.classList.add("prematch-open");
var current_turn = 0;
var deadline_at = 0;
var slot = null;
var is_ready = false;
var match_started = false;
var latest_state = null;
var opponent_ready = false;
var opponent_name = null;
var is_spectator = false;
var last_ready_snapshot = null;
var participants = null;
var ready_order = [];
var intent_locked = false;
var hp_animation = {};
var animation_timers = [];
var sprite_fx_classes = ["jump", "hit", "heal", "shield-on", "shield-hit"];
var selected = [];
var active_tab = null;
function icon_path(id) {
  return `/icons/unit_${id}.png`;
}
function monster_label(id, fallback = "mon") {
  if (!id)
    return fallback;
  return roster_by_id.get(id)?.name ?? id;
}
function append_log(line) {
  append_line(log_list, line);
}
function append_chat(line) {
  append_line(chat_messages, line);
}
function send_chat_message(message) {
  const trimmed = message.trim();
  if (!trimmed)
    return;
  post(room, { $: "chat", message: trimmed.slice(0, 200), from: player_name });
}
function setup_chat_input(input, button) {
  if (!input || !button)
    return;
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
function append_line(container, line) {
  if (!container)
    return;
  const p = document.createElement("p");
  p.textContent = line;
  container.appendChild(p);
  container.scrollTop = container.scrollHeight;
}
function render_participants() {
  participants_list.innerHTML = "";
  if (!participants) {
    return;
  }
  const label_map = new Map;
  if (ready_order[0])
    label_map.set(ready_order[0], "P1");
  if (ready_order[1])
    label_map.set(ready_order[1], "P2");
  const player_order = ready_order.length ? ready_order.concat(PLAYER_SLOTS).filter((value, index, self) => self.indexOf(value) === index) : PLAYER_SLOTS;
  for (const slot_id of player_order) {
    const name = participants.players[slot_id];
    if (!name)
      continue;
    const item = document.createElement("div");
    item.className = "participant";
    let meta = "waiting";
    const label = label_map.get(slot_id);
    if (label === "P1") {
      meta = `P1 ${ready_order.length >= 2 ? "ready" : "waiting"}`;
    } else if (label === "P2") {
      meta = "P2 ready";
    }
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
function update_deadline() {
  if (deadline_at <= 0) {
    status_deadline.textContent = "--:--";
    return;
  }
  const remaining = Math.max(0, deadline_at - Date.now());
  const minutes = Math.floor(remaining / 60000);
  const seconds = Math.floor(remaining % 60000 / 1000);
  status_deadline.textContent = `${minutes.toString().padStart(2, "0")}:${seconds.toString().padStart(2, "0")}`;
}
function show_warning(message) {
  config_warning.textContent = message;
}
function clear_warning() {
  config_warning.textContent = "";
}
function load_json(key, fallback) {
  try {
    const raw = localStorage.getItem(key);
    if (!raw)
      return fallback;
    return JSON.parse(raw);
  } catch {
    return fallback;
  }
}
function save_json(key, value) {
  try {
    localStorage.setItem(key, JSON.stringify(value));
  } catch {}
}
function load_profile() {
  const parsed = load_json(profile_key, null);
  if (parsed && typeof parsed === "object" && parsed.monsters) {
    return { monsters: parsed.monsters };
  }
  return { monsters: {} };
}
var profile = load_profile();
function save_profile() {
  save_json(profile_key, profile);
}
function load_team_selection() {
  const parsed = load_json(team_key, null);
  if (parsed && Array.isArray(parsed.selected)) {
    selected.splice(0, selected.length, ...parsed.selected.filter((id) => roster_by_id.has(id)));
  }
}
function save_team_selection() {
  save_json(team_key, { selected: selected.slice() });
}
function coerce_config(spec, value) {
  const base = {
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
    stats: { ...base.stats }
  };
}
function get_config(monster_id) {
  const spec = roster_by_id.get(monster_id);
  if (!spec) {
    throw new Error(`Missing monster spec: ${monster_id}`);
  }
  const config = coerce_config(spec, profile.monsters[monster_id]);
  profile.monsters[monster_id] = config;
  save_profile();
  return config;
}
function update_roster_count() {
  roster_count.textContent = `${selected.length}/3`;
}
function update_slots() {
  slot_active.textContent = monster_label(selected[0], "empty");
  slot_bench_a.textContent = monster_label(selected[1], "empty");
  slot_bench_b.textContent = monster_label(selected[2], "empty");
}
function render_tabs() {
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
function render_config() {
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
  for (let i = 0;i < 4; i++) {
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
    if (is_ready && !match_started)
      return;
    config.passive = passive_select.value;
    save_profile();
  });
  passive_label.appendChild(passive_select);
  passive_grid.appendChild(passive_label);
  const stat_fields = [
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
      if (is_ready && !match_started)
        return;
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
function set_active_index(index) {
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
function toggle_selection(id) {
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
function render_roster() {
  const list = document.getElementById("roster-list");
  list.innerHTML = "";
  for (const entry of roster) {
    const card = document.createElement("div");
    const is_selected = selected.includes(entry.id);
    const is_disabled = !is_selected && selected.length >= 3 || is_ready && !match_started;
    card.className = `roster-card${is_selected ? " active" : ""}${is_disabled ? " disabled" : ""}`;
    card.innerHTML = `
      <div class="sprite" style="width:36px;height:36px;">
        <img src="${icon_path(entry.id)}" alt="${entry.name}" />
      </div>
      <div>
        <h4>${entry.name}</h4>
        <p>${entry.role}</p>
      </div>
    `;
    card.addEventListener("click", () => {
      if (is_disabled)
        return;
      toggle_selection(entry.id);
    });
    list.appendChild(card);
  }
}
function update_action_controls() {
  const has_team = selected.length === 3;
  const pending_switch = has_pending_switch();
  const controls_disabled = !match_started || !slot || is_spectator || intent_locked || current_turn <= 0 || pending_switch;
  if (!has_team) {
    move_buttons.forEach((btn, index) => {
      btn.textContent = `Move ${index + 1}`;
      btn.disabled = true;
    });
    switch_btn.disabled = true;
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
  const switch_disabled = !match_started || !slot || is_spectator || !pending_switch && intent_locked || !pending_switch && current_turn <= 0;
  switch_btn.disabled = switch_disabled;
  surrender_btn.disabled = !match_started || !slot || is_spectator;
}
function has_pending_switch() {
  return !!(latest_state && slot && latest_state.pendingSwitch?.[slot]);
}
function can_send_intent() {
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
function send_move_intent(moveIndex) {
  if (!can_send_intent())
    return;
  post(room, { $: "intent", turn: current_turn, intent: { action: "use_move", moveIndex } });
  intent_locked = true;
  update_action_controls();
  append_log("intent sent");
}
function send_surrender() {
  if (!match_started || is_spectator || !slot)
    return;
  post(room, { $: "surrender" });
}
function close_switch_modal() {
  switch_modal.classList.remove("open");
}
function open_switch_modal(mode = "intent") {
  if (!latest_state || !slot)
    return;
  if (mode === "intent" && !can_send_intent())
    return;
  switch_options.innerHTML = "";
  const player = latest_state.players[slot];
  const active_index = player.activeIndex;
  const options = player.team.map((mon, index) => ({ mon, index })).filter((entry) => entry.index !== active_index);
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
          if (!can_send_intent())
            return;
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
function build_team_selection() {
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
function send_ready(next_ready) {
  if (match_started || is_spectator || !slot) {
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
function update_ready_ui() {
  if (status_ready) {
    status_ready.textContent = is_ready ? "ready" : "not ready";
    status_ready.className = `status-pill ${is_ready ? "ok" : "off"}`;
  }
  ready_btn.textContent = is_ready ? "Unready" : "Ready";
  ready_btn.disabled = is_spectator || !slot;
  if (match_started) {
    prematch_hint.textContent = "Match started.";
    return;
  }
  if (is_spectator) {
    prematch_hint.textContent = "Spectator mode. Waiting for players to ready.";
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
function update_opponent_ui(opponent_ready2, opponent_name2) {
  if (!status_opponent)
    return;
  status_opponent.textContent = opponent_ready2 ? "ready" : opponent_name2 ? "waiting" : "offline";
  status_opponent.className = `status-pill ${opponent_ready2 ? "ok" : opponent_name2 ? "warn" : "off"}`;
}
function show_match_end(winner) {
  if (!match_end)
    return;
  const is_winner = winner && slot === winner;
  match_end_title.textContent = is_winner ? "Victory" : "Defeat";
  if (!winner) {
    match_end_title.textContent = "Match ended";
  }
  match_end_sub.textContent = winner ? `${winner} wins the match.` : "Match finished.";
  match_end.classList.add("open");
}
function handle_turn_start(data) {
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
function log_events(log) {
  for (const entry of log) {
    if (entry.type === "damage") {
      const data = entry.data;
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
function update_panels(state, opts) {
  if (!slot)
    return;
  const me = state.players[slot];
  const opp = state.players[slot === "player1" ? "player2" : "player1"];
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
  enemy_title.textContent = opp.name || "Opponent";
  if (!opts?.skipMeta?.enemy) {
    enemy_meta.textContent = `Lv ${opp_active.level} · HP ${opp_active.hp}/${opp_active.maxHp}`;
  }
  if (!opts?.skipBar?.enemy) {
    enemy_hp.style.width = `${Math.max(0, Math.min(1, opp_active.hp / opp_active.maxHp)) * 100}%`;
  }
  enemy_sprite.src = icon_path(opp_active.id);
}
function animate_hp_text(side, level, from, to, maxHp, delay = 180) {
  const target = side === "player" ? player_meta : enemy_meta;
  const start = performance.now();
  const duration = 260;
  const raf_key = side;
  if (hp_animation[raf_key]) {
    cancelAnimationFrame(hp_animation[raf_key]);
  }
  const tick = (now2) => {
    const elapsed = now2 - start;
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
function clear_animation_timers() {
  while (animation_timers.length) {
    const id = animation_timers.pop();
    if (id !== undefined) {
      clearTimeout(id);
    }
  }
  reset_sprite_fx();
}
function schedule_animation(fn, delay) {
  const id = window.setTimeout(fn, delay);
  animation_timers.push(id);
}
function side_from_slot(viewer_slot, slot_id) {
  if (!viewer_slot) {
    return slot_id === "player1" ? "player" : "enemy";
  }
  return slot_id === viewer_slot ? "player" : "enemy";
}
function build_visual_steps(prev_state, log, viewer_slot) {
  const temp = JSON.parse(JSON.stringify(prev_state));
  const steps = [];
  for (const entry of log) {
    if (entry.type === "switch" || entry.type === "forced_switch") {
      const data = entry.data;
      if (!data || !data.slot || typeof data.to !== "number")
        continue;
      temp.players[data.slot].activeIndex = data.to;
      continue;
    }
    if (entry.type === "protect") {
      const data = entry.data;
      if (!data?.slot)
        continue;
      const side = side_from_slot(viewer_slot, data.slot);
      steps.push({ kind: "shield_on", side });
      continue;
    }
    if (entry.type === "damage_blocked") {
      const data = entry.data;
      if (!data?.slot)
        continue;
      const defenderSide2 = side_from_slot(viewer_slot, data.slot);
      const attackerSide2 = defenderSide2 === "player" ? "enemy" : "player";
      steps.push({ kind: "shield_hit", attackerSide: attackerSide2, defenderSide: defenderSide2 });
      continue;
    }
    if (entry.type === "passive_heal") {
      const data = entry.data;
      if (!data?.slot)
        continue;
      const side = side_from_slot(viewer_slot, data.slot);
      steps.push({ kind: "heal", side });
      continue;
    }
    if (entry.type !== "damage" && entry.type !== "recoil")
      continue;
    const payload = entry.data;
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
function animate_hp_bar(bar, from, to) {
  bar.classList.remove("hp-anim");
  bar.style.transition = "none";
  bar.style.width = `${from}%`;
  bar.offsetWidth;
  bar.style.transition = "";
  bar.classList.add("hp-anim");
  bar.style.width = `${to}%`;
  window.setTimeout(() => {
    bar.classList.remove("hp-anim");
  }, 450);
}
function sprite_wrap(side) {
  return side === "player" ? player_sprite_wrap : enemy_sprite_wrap;
}
function reset_sprite_fx() {
  [player_sprite_wrap, enemy_sprite_wrap].forEach((wrap) => {
    sprite_fx_classes.forEach((fx) => wrap.classList.remove(fx));
    wrap.style.transform = "";
  });
}
function trigger_class(el, className, duration) {
  el.classList.remove(className);
  el.offsetWidth;
  el.classList.add(className);
  window.setTimeout(() => {
    el.classList.remove(className);
  }, duration);
}
function handle_state(data) {
  const prev_state = latest_state;
  clear_animation_timers();
  const steps = prev_state ? build_visual_steps(prev_state, data.log, slot) : [];
  const hit_sides = new Set(steps.filter((step) => step.kind === "damage").map((step) => step.defenderSide));
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
      const duration = step.kind === "damage" ? 650 : step.kind === "shield_hit" ? 420 : step.kind === "shield_on" ? 360 : 320;
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
function handle_post(message) {
  const data = message.data;
  switch (data.$) {
    case "assign":
      slot = data.slot;
      if (status_slot)
        status_slot.textContent = data.slot;
      status_conn.textContent = "synced";
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
      if (status_slot)
        status_slot.textContent = "spectator";
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
switch_btn.addEventListener("click", () => {
  open_switch_modal(has_pending_switch() ? "forced" : "intent");
});
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
  if (is_ready && !match_started)
    return;
  set_active_index(0);
});
slot_bench_a.addEventListener("click", () => {
  if (is_ready && !match_started)
    return;
  set_active_index(1);
});
slot_bench_b.addEventListener("click", () => {
  if (is_ready && !match_started)
    return;
  set_active_index(2);
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
  setup_chat_input(chat_input, chat_send);
});
