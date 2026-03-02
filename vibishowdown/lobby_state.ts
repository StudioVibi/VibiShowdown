import type { MonsterCatalogEntry } from "../src/data/exports.ts";
import { normalize_int } from "../src/int_math.ts";
import type { EVSpread, Stats, TeamSelection } from "../src/shared.ts";
import { LEVEL_MAX, LEVEL_MIN, calc_final_stats, empty_ev_spread, validate_ev_spread } from "../src/stats_calc.ts";

export type MonsterConfig = {
  moves: string[];
  passive: string;
  stats: Stats;
  ev: EVSpread;
};

export type Profile = {
  monsters: Record<string, MonsterConfig>;
};

type EVStatKey = keyof EVSpread;
const EV_KEYS: EVStatKey[] = ["hp", "atk", "def", "spe"];
const LEGACY_MONSTER_ID_ALIASES: Record<string, string> = {
  night: "night_sekyps"
};
const TEAM_SELECTION_SIZE = 3;

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

function canonical_monster_id(id: string): string {
  return LEGACY_MONSTER_ID_ALIASES[id] ?? id;
}

function normalize_stats(value: Partial<Stats> | undefined, fallback: Stats): Stats {
  const source = value ?? {};
  return {
    level: normalize_stat_value("level", source.level, fallback.level),
    maxHp: normalize_stat_value("maxHp", source.maxHp, fallback.maxHp),
    attack: normalize_stat_value("attack", source.attack, fallback.attack),
    defense: normalize_stat_value("defense", source.defense, fallback.defense),
    speed: normalize_stat_value("speed", source.speed, fallback.speed)
  };
}

function normalize_legacy_ev_from_stat_alloc(value: unknown): EVSpread | null {
  const source =
    typeof value === "object" && value !== null
      ? (value as Partial<Record<"maxHp" | "attack" | "defense" | "speed", unknown>>)
      : null;
  if (!source) return null;
  return {
    hp: read_ev_value(source.maxHp, 0),
    atk: read_ev_value(source.attack, 0),
    def: read_ev_value(source.defense, 0),
    spe: read_ev_value(source.speed, 0)
  };
}

function stats_equal(left: Stats, right: Stats): boolean {
  return (
    left.level === right.level &&
    left.maxHp === right.maxHp &&
    left.attack === right.attack &&
    left.defense === right.defense &&
    left.speed === right.speed
  );
}

function ev_equal(left: EVSpread, right: EVSpread): boolean {
  return left.hp === right.hp && left.atk === right.atk && left.def === right.def && left.spe === right.spe;
}

function read_ev_value(value: unknown, fallback: number): number {
  return typeof value === "number" && Number.isFinite(value) ? value : fallback;
}

export function normalize_stat_value(key: keyof Stats, value: unknown, fallback: number): number {
  const candidate = typeof value === "number" ? value : fallback;
  if (key === "level") {
    return Math.min(LEVEL_MAX, Math.max(LEVEL_MIN, normalize_int(candidate, fallback, LEVEL_MIN)));
  }
  if (key === "maxHp") {
    return normalize_int(candidate, fallback, 1);
  }
  return normalize_int(candidate, fallback, 0);
}

export function ev_total(ev: EVSpread): number {
  return EV_KEYS.reduce((sum, key) => sum + ev[key], 0);
}

export function normalize_ev_spread(value: unknown, fallback: EVSpread = empty_ev_spread()): EVSpread {
  const source = (typeof value === "object" && value !== null ? value : {}) as Partial<EVSpread>;
  return {
    hp: read_ev_value(source.hp, fallback.hp),
    atk: read_ev_value(source.atk, fallback.atk),
    def: read_ev_value(source.def, fallback.def),
    spe: read_ev_value(source.spe, fallback.spe)
  };
}

export function stats_from_base_level_ev(base: Stats, level: number, ev: EVSpread): Stats {
  const final = calc_final_stats(
    {
      hp: base.maxHp,
      atk: base.attack,
      def: base.defense,
      spe: base.speed
    },
    level,
    ev
  );
  return {
    level,
    maxHp: final.hpMax,
    attack: final.atk,
    defense: final.def,
    speed: final.spe
  };
}

export function default_lobby_moves_for_spec(spec: MonsterCatalogEntry, lobby_move_slots: number): string[] {
  const default_moves = spec.defaultMoves.slice(0, lobby_move_slots).map((move_id) => (move_id === "run" ? "none" : move_id));
  while (default_moves.length < lobby_move_slots) {
    default_moves.push("none");
  }
  return default_moves;
}

export function base_stats_from_spec(spec: MonsterCatalogEntry): Stats {
  return normalize_stats(spec.stats, spec.stats);
}

export function load_profile(profile_key: string, roster_by_id: Map<string, MonsterCatalogEntry>): Profile {
  const parsed = load_json<Profile | null>(profile_key, null);
  if (parsed && typeof parsed === "object" && parsed.monsters) {
    const source = parsed.monsters as Record<string, MonsterConfig>;
    const migrated: Record<string, MonsterConfig> = {};
    let changed = false;
    for (const [raw_id, config] of Object.entries(source)) {
      const id = canonical_monster_id(raw_id);
      if (id !== raw_id) {
        changed = true;
      }
      if (!roster_by_id.has(id)) {
        changed = true;
        continue;
      }
      if (migrated[id]) {
        changed = true;
        continue;
      }
      migrated[id] = config;
    }
    if (changed) {
      save_json(profile_key, { monsters: migrated });
    }
    return { monsters: migrated };
  }
  return { monsters: {} };
}

export function save_profile(profile_key: string, profile: Profile): void {
  save_json(profile_key, profile);
}

export function load_team_selection(
  team_key: string,
  roster_by_id: Map<string, MonsterCatalogEntry>,
  is_lobby_enabled_monster: (id: string) => boolean,
  max_selection: number
): string[] {
  const parsed = load_json<{ selected?: string[] } | null>(team_key, null);
  if (!parsed || !Array.isArray(parsed.selected)) {
    return [];
  }
  const filtered = parsed.selected
    .map((id: string) => canonical_monster_id(id))
    .filter((id: string) => roster_by_id.has(id) && is_lobby_enabled_monster(id))
    .slice(0, max_selection);
  const changed =
    filtered.length !== parsed.selected.length || filtered.some((id, index) => id !== parsed.selected?.[index]);
  if (changed) {
    save_team_selection(team_key, filtered);
  }
  return filtered;
}

export function save_team_selection(team_key: string, selected: readonly string[]): void {
  save_json(team_key, { selected: selected.slice() });
}

export function coerce_config(
  spec: MonsterCatalogEntry,
  value: MonsterConfig | undefined,
  lobby_move_slots: number
): MonsterConfig {
  const base_stats = base_stats_from_spec(spec);
  const base_level = normalize_stat_value("level", base_stats.level, 1);
  const base_ev = empty_ev_spread();
  const default_moves = default_lobby_moves_for_spec(spec, lobby_move_slots);
  const base: MonsterConfig = {
    moves: default_moves,
    passive: "none",
    stats: stats_from_base_level_ev(base_stats, base_level, base_ev),
    ev: base_ev
  };

  if (!value) {
    return base;
  }

  const moves = Array.isArray(value.moves) ? value.moves.slice(0, lobby_move_slots) : base.moves.slice();
  while (moves.length < lobby_move_slots) {
    moves.push("none");
  }
  const allowed = new Set(spec.possibleMoves);
  allowed.delete("run");
  let had_disallowed_move = false;
  for (let i = 0; i < moves.length; i++) {
    if (moves[i] === "bells_drum") {
      moves[i] = "belly_drum";
    }
    if (moves[i] === "cast") {
      moves[i] = "throw";
    }
    if (!allowed.has(moves[i])) {
      had_disallowed_move = true;
      moves[i] = "none";
    }
  }
  if (had_disallowed_move) {
    const used_moves = new Set(moves.filter((move_id) => move_id !== "none"));
    for (let i = 0; i < moves.length; i++) {
      if (moves[i] !== "none") {
        continue;
      }
      const fallback_move = default_moves[i] ?? "none";
      if (fallback_move === "none") {
        continue;
      }
      if (!allowed.has(fallback_move)) {
        continue;
      }
      if (used_moves.has(fallback_move)) {
        continue;
      }
      moves[i] = fallback_move;
      used_moves.add(fallback_move);
    }
  }
  const level = normalize_stat_value("level", value.stats?.level, base.stats.level);
  const legacy_ev = normalize_legacy_ev_from_stat_alloc((value as { statAlloc?: unknown }).statAlloc);
  const ev = { ...normalize_ev_spread(value.ev ?? legacy_ev ?? base.ev, base.ev), hp: 0 };
  const stats = stats_from_base_level_ev(base_stats, level, ev);

  return {
    moves,
    passive: "none",
    stats,
    ev
  };
}

type GetConfigOptions = {
  monster_id: string;
  roster_by_id: Map<string, MonsterCatalogEntry>;
  profile: Profile;
  profile_key: string;
  lobby_move_slots: number;
};

export function get_config(opts: GetConfigOptions): MonsterConfig {
  const spec = opts.roster_by_id.get(opts.monster_id);
  if (!spec) {
    throw new Error(`Missing monster spec: ${opts.monster_id}`);
  }
  const existing = opts.profile.monsters[opts.monster_id];
  const coerced = coerce_config(spec, existing, opts.lobby_move_slots);
  if (!existing) {
    opts.profile.monsters[opts.monster_id] = coerced;
    save_profile(opts.profile_key, opts.profile);
    return coerced;
  }
  const has_existing_shape =
    Array.isArray(existing.moves) &&
    typeof existing.passive === "string" &&
    typeof existing.stats === "object" &&
    existing.stats !== null &&
    typeof existing.ev === "object" &&
    existing.ev !== null;
  if (!has_existing_shape) {
    opts.profile.monsters[opts.monster_id] = coerced;
    save_profile(opts.profile_key, opts.profile);
    return coerced;
  }

  let changed = false;
  if (existing.passive !== coerced.passive) {
    existing.passive = coerced.passive;
    changed = true;
  }
  if (!stats_equal(existing.stats, coerced.stats)) {
    existing.stats = coerced.stats;
    changed = true;
  }
  if (!ev_equal(existing.ev, coerced.ev)) {
    existing.ev = coerced.ev;
    changed = true;
  }
  const existing_moves = existing.moves.slice(0, opts.lobby_move_slots);
  const coerced_moves = coerced.moves.slice(0, opts.lobby_move_slots);
  if (
    existing_moves.length !== coerced_moves.length ||
    existing_moves.some((move, idx) => move !== coerced_moves[idx])
  ) {
    existing.moves = coerced_moves;
    changed = true;
  }

  if (changed) {
    save_profile(opts.profile_key, opts.profile);
  }
  return existing;
}

type ResetProfileStatsToDefaultsOptions = {
  profile: Profile;
  profile_key: string;
  roster: readonly MonsterCatalogEntry[];
  lobby_move_slots: number;
};

export function reset_profile_stats_to_defaults(opts: ResetProfileStatsToDefaultsOptions): boolean {
  let changed = false;
  for (const spec of opts.roster) {
    const config = coerce_config(spec, opts.profile.monsters[spec.id], opts.lobby_move_slots);
    const base_stats = base_stats_from_spec(spec);
    const default_ev = empty_ev_spread();
    const default_moves = default_lobby_moves_for_spec(spec, opts.lobby_move_slots);
    const default_stats = stats_from_base_level_ev(base_stats, base_stats.level, default_ev);
    if (config.moves.some((move, index) => move !== default_moves[index])) {
      changed = true;
    }
    if (config.passive !== "none") {
      changed = true;
    }
    if (!stats_equal(config.stats, default_stats)) {
      changed = true;
    }
    if (!ev_equal(config.ev, default_ev)) {
      changed = true;
    }
    opts.profile.monsters[spec.id] = {
      moves: default_moves,
      passive: "none",
      stats: default_stats,
      ev: default_ev
    };
  }
  save_profile(opts.profile_key, opts.profile);
  return changed;
}

export type BuildTeamSelectionResult = {
  team: TeamSelection | null;
  warning: string | null;
};

type BuildTeamSelectionOptions = {
  selected: readonly string[];
  roster_by_id: Map<string, MonsterCatalogEntry>;
  lobby_move_slots: number;
  is_lobby_enabled_monster: (id: string) => boolean;
  monster_label: (id: string) => string;
  get_config: (monster_id: string) => MonsterConfig;
};

export function build_team_selection(opts: BuildTeamSelectionOptions): BuildTeamSelectionResult {
  if (opts.selected.length !== TEAM_SELECTION_SIZE) {
    return { team: null, warning: "Select exactly 3 monsters before ready." };
  }

  const monsters: TeamSelection["monsters"] = [];
  for (const id of opts.selected) {
    if (!opts.is_lobby_enabled_monster(id)) {
      return { team: null, warning: `${opts.monster_label(id)} is disabled.` };
    }
    const spec = opts.roster_by_id.get(id);
    if (!spec) {
      return { team: null, warning: `Unknown monster: ${id}` };
    }
    const base_stats = base_stats_from_spec(spec);
    const config = opts.get_config(id);
    const ev_error = validate_ev_spread(config.ev);
    if (ev_error) {
      return { team: null, warning: `${opts.monster_label(id)}: ${ev_error}` };
    }
    const level = normalize_stat_value("level", config.stats.level, base_stats.level);
    const stats = stats_from_base_level_ev(base_stats, level, config.ev);
    config.stats = stats;
    monsters.push({
      id,
      type: spec.type,
      moves: config.moves.slice(0, opts.lobby_move_slots),
      passive: "none",
      stats: { ...stats },
      ev: { ...config.ev }
    });
  }

  return {
    team: { monsters, activeIndex: 0 },
    warning: null
  };
}
