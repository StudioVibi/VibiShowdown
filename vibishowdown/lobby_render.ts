import type { MonsterCatalogEntry } from "../src/data/exports.ts";
import type { EVSpread, Stats } from "../src/shared.ts";
import type { MonsterConfig as LobbyMonsterConfig } from "./lobby_state.ts";

export type RenderLobbyConfigContext = {
  active_tab: string | null;
  moves_grid: HTMLElement;
  stats_grid: HTMLElement;
  roster_by_id: Map<string, MonsterCatalogEntry>;
  get_config: (monster_id: string) => LobbyMonsterConfig;
  base_stats_from_spec: (spec: MonsterCatalogEntry) => Stats;
  stats_from_base_level_ev: (base: Stats, level: number, ev: EVSpread) => Stats;
  save_profile: () => void;
  clear_warning: () => void;
  show_warning: (message: string) => void;
  is_ready: boolean;
  match_started: boolean;
  lobby_move_slots: number;
  move_labels: Record<string, string>;
  level_min: number;
  level_max: number;
  ev_per_stat_max: number;
  ev_total_max: number;
  ev_total: (ev: EVSpread) => number;
  calc_non_hp_stat: (base: number, level: number, ev: number, iv: number, nature: number) => number;
  validate_ev_spread: (ev: EVSpread) => string | null;
  refresh_lobby_tooltips: () => void;
  update_action_controls: () => void;
  rerender: () => void;
};

export function render_lobby_config(ctx: RenderLobbyConfigContext): void {
  ctx.moves_grid.innerHTML = "";
  ctx.stats_grid.innerHTML = "";

  if (!ctx.active_tab) {
    ctx.show_warning("Select 3 monsters to configure.");
    return;
  }

  ctx.clear_warning();
  const spec = ctx.roster_by_id.get(ctx.active_tab);
  if (!spec) {
    ctx.show_warning("Unknown monster.");
    return;
  }

  const config = ctx.get_config(ctx.active_tab);
  const base_stats = ctx.base_stats_from_spec(spec);
  config.stats = ctx.stats_from_base_level_ev(base_stats, config.stats.level, config.ev);

  let changed = false;
  const unique_moves = new Set<string>();
  for (let i = 0; i < ctx.lobby_move_slots; i++) {
    const move = config.moves[i] ?? "none";
    if (move === "none") {
      if (config.moves[i] !== "none") {
        config.moves[i] = "none";
        changed = true;
      }
      continue;
    }
    if (move === "run") {
      config.moves[i] = "none";
      changed = true;
      continue;
    }
    if (unique_moves.has(move)) {
      config.moves[i] = "none";
      changed = true;
      continue;
    }
    unique_moves.add(move);
  }
  while (config.moves.length < ctx.lobby_move_slots) {
    config.moves.push("none");
    changed = true;
  }
  if (config.moves.length > ctx.lobby_move_slots) {
    config.moves = config.moves.slice(0, ctx.lobby_move_slots);
    changed = true;
  }
  if (changed) {
    ctx.save_profile();
  }

  for (let i = 0; i < ctx.lobby_move_slots; i++) {
    const label = document.createElement("label");
    label.textContent = `Move ${i + 1}`;
    const select = document.createElement("select");
    select.dataset.index = `${i}`;
    const current_move = config.moves[i] ?? "none";
    const used_by_others = new Set(
      config.moves.filter((move, idx) => idx !== i && move !== "none")
    );
    for (const move of spec.possibleMoves) {
      if (move === "run") {
        continue;
      }
      if (move !== "none" && move !== current_move && used_by_others.has(move)) {
        continue;
      }
      const option = document.createElement("option");
      option.value = move;
      option.textContent = ctx.move_labels[move] || move;
      select.appendChild(option);
    }
    const has_current = Array.from(select.options).some((option) => option.value === current_move);
    select.value = has_current ? current_move : "none";
    if (!has_current) {
      config.moves[i] = "none";
      ctx.save_profile();
    }
    select.dataset.prev = select.value;
    select.disabled = ctx.is_ready && !ctx.match_started;
    const apply_move_value = (next_value: string): void => {
      const idx = Number(select.dataset.index);
      if (!Number.isInteger(idx)) {
        return;
      }
      select.dataset.prev = next_value;
      if (config.moves[idx] === next_value) {
        return;
      }
      config.moves[idx] = next_value;
      ctx.save_profile();
    };
    select.addEventListener("input", () => {
      if (ctx.is_ready && !ctx.match_started) {
        select.value = select.dataset.prev || "none";
        return;
      }
      apply_move_value(select.value);
      ctx.clear_warning();
      ctx.update_action_controls();
    });
    select.addEventListener("change", () => {
      if (ctx.is_ready && !ctx.match_started) {
        select.value = select.dataset.prev || "none";
        return;
      }
      apply_move_value(select.value);
      ctx.clear_warning();
      ctx.rerender();
      ctx.update_action_controls();
    });
    label.appendChild(select);
    ctx.moves_grid.appendChild(label);
  }

  const level_label = document.createElement("label");
  level_label.textContent = "Lv";
  const level_input = document.createElement("input");
  level_input.type = "number";
  level_input.min = `${ctx.level_min}`;
  level_input.max = `${ctx.level_max}`;
  level_input.value = `${config.stats.level}`;
  level_input.disabled = ctx.is_ready && !ctx.match_started;
  const read_level_input_value = (): number | null => {
    const raw = level_input.value.trim();
    if (!raw) {
      return null;
    }
    const parsed = Number(raw);
    if (!Number.isFinite(parsed)) {
      return null;
    }
    return parsed;
  };
  const apply_level_value = (next_value: number): number => {
    const normalized = Math.min(ctx.level_max, Math.max(ctx.level_min, Math.round(next_value)));
    if (normalized !== config.stats.level) {
      config.stats = ctx.stats_from_base_level_ev(base_stats, normalized, config.ev);
      ctx.save_profile();
      ctx.refresh_lobby_tooltips();
    }
    return normalized;
  };
  level_input.addEventListener("input", () => {
    if (ctx.is_ready && !ctx.match_started) return;
    const value = read_level_input_value();
    if (value === null) {
      return;
    }
    apply_level_value(value);
    ctx.clear_warning();
  });
  const commit_level_input = (): void => {
    if (ctx.is_ready && !ctx.match_started) return;
    const value = read_level_input_value();
    if (value === null) {
      level_input.value = `${config.stats.level}`;
      return;
    }
    const normalized = apply_level_value(value);
    level_input.value = `${normalized}`;
    ctx.clear_warning();
    ctx.rerender();
  };
  level_input.addEventListener("change", commit_level_input);
  level_input.addEventListener("blur", commit_level_input);
  level_label.appendChild(level_input);
  ctx.moves_grid.appendChild(level_label);

  const points_summary = document.createElement("div");
  points_summary.className = "stat-points-summary";
  ctx.stats_grid.appendChild(points_summary);

  const column_header = document.createElement("div");
  column_header.className = "stat-alloc-header";
  for (const heading of ["", "Base", "EV's", "", "Total"]) {
    const header_cell = document.createElement("span");
    header_cell.className = "stat-alloc-header-cell";
    if (heading.length === 0) {
      header_cell.classList.add("is-empty");
      header_cell.textContent = " ";
    } else {
      header_cell.textContent = heading;
    }
    column_header.appendChild(header_cell);
  }
  ctx.stats_grid.appendChild(column_header);

  const update_points_summary = (): void => {
    const used = ctx.ev_total(config.ev);
    const remaining = ctx.ev_total_max - used;
    points_summary.textContent = `EVs: ${used}/${ctx.ev_total_max} (restante: ${Math.max(0, remaining)})`;
  };

  const stat_rows: Array<[Exclude<keyof EVSpread, "hp">, string]> = [
    ["atk", "ATK"],
    ["def", "DEF"],
    ["spe", "DEX"]
  ];
  const stat_key_by_ev: Record<Exclude<keyof EVSpread, "hp">, keyof Stats> = {
    atk: "attack",
    def: "defense",
    spe: "speed"
  };
  const calc_total_stat = (key: Exclude<keyof EVSpread, "hp">): number => {
    const base = base_stats[stat_key_by_ev[key]];
    const level = config.stats.level;
    return ctx.calc_non_hp_stat(base, level, config.ev[key], 0, 1);
  };

  for (const [key, label_text] of stat_rows) {
    const row = document.createElement("div");
    row.className = "stat-alloc-row";

    const stat_name = document.createElement("span");
    stat_name.className = "stat-alloc-name";
    stat_name.textContent = label_text;

    const base_value = document.createElement("span");
    base_value.className = "stat-static-value";
    base_value.textContent = `${base_stats[stat_key_by_ev[key]]}`;

    const alloc_input = document.createElement("input");
    alloc_input.type = "number";
    alloc_input.className = "stat-alloc-input";
    alloc_input.min = "0";
    alloc_input.max = `${ctx.ev_per_stat_max}`;
    alloc_input.step = "1";
    alloc_input.value = `${config.ev[key]}`;
    alloc_input.disabled = ctx.is_ready && !ctx.match_started;

    const alloc_slider = document.createElement("input");
    alloc_slider.type = "range";
    alloc_slider.className = "stat-alloc-slider";
    alloc_slider.min = "0";
    alloc_slider.max = `${ctx.ev_per_stat_max}`;
    alloc_slider.value = `${config.ev[key]}`;
    alloc_slider.disabled = ctx.is_ready && !ctx.match_started;

    const result_value = document.createElement("span");
    result_value.className = "stat-result-value";
    result_value.textContent = `${calc_total_stat(key)}`;

    const max_ev_for_key = (): number => {
      const used_without_current = ctx.ev_total(config.ev) - config.ev[key];
      return Math.min(ctx.ev_per_stat_max, Math.max(0, ctx.ev_total_max - used_without_current));
    };

    const apply_allocation_value = (next_raw: number, source: "input" | "slider"): void => {
      const current = config.ev[key];
      if (!Number.isFinite(next_raw)) {
        alloc_input.value = `${current}`;
        alloc_slider.value = `${current}`;
        return;
      }

      if (source === "slider") {
        const clamped = Math.max(0, Math.min(max_ev_for_key(), Math.floor(next_raw)));
        const candidate: EVSpread = { ...config.ev, [key]: clamped };
        config.ev = candidate;
        config.stats = ctx.stats_from_base_level_ev(base_stats, config.stats.level, config.ev);
        alloc_input.value = `${clamped}`;
        alloc_slider.value = `${clamped}`;
        result_value.textContent = `${calc_total_stat(key)}`;
        ctx.clear_warning();
        update_points_summary();
        ctx.save_profile();
        ctx.refresh_lobby_tooltips();
        return;
      }

      if (!Number.isInteger(next_raw)) {
        ctx.show_warning(`EV ${key} must be integer.`);
        alloc_input.value = `${current}`;
        alloc_slider.value = `${current}`;
        return;
      }
      const candidate: EVSpread = { ...config.ev, [key]: next_raw };
      const ev_error = ctx.validate_ev_spread(candidate);
      if (ev_error) {
        ctx.show_warning(ev_error);
        alloc_input.value = `${current}`;
        alloc_slider.value = `${current}`;
        return;
      }
      config.ev = candidate;
      config.stats = ctx.stats_from_base_level_ev(base_stats, config.stats.level, config.ev);
      alloc_input.value = `${next_raw}`;
      alloc_slider.value = `${next_raw}`;
      result_value.textContent = `${calc_total_stat(key)}`;
      ctx.clear_warning();
      update_points_summary();
      ctx.save_profile();
      ctx.refresh_lobby_tooltips();
    };

    alloc_input.addEventListener("change", () => {
      if (ctx.is_ready && !ctx.match_started) return;
      const value = Number(alloc_input.value);
      if (!Number.isFinite(value)) {
        alloc_input.value = `${config.ev[key]}`;
        return;
      }
      apply_allocation_value(value, "input");
    });

    alloc_slider.addEventListener("input", () => {
      if (ctx.is_ready && !ctx.match_started) return;
      apply_allocation_value(Number(alloc_slider.value), "slider");
    });

    row.appendChild(stat_name);
    row.appendChild(base_value);
    row.appendChild(alloc_input);
    row.appendChild(alloc_slider);
    row.appendChild(result_value);
    ctx.stats_grid.appendChild(row);
  }

  update_points_summary();
}
