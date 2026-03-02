import { MONSTER_BY_ID } from "../src/data/exports.ts";
import type { MonsterCatalogEntry } from "../src/data/exports.ts";
import { LEVEL_MAX, LEVEL_MIN } from "../src/stats_calc.ts";
import type { EVSpread } from "../src/shared.ts";
import {
  type MonsterConfig,
  build_team_selection,
  coerce_config,
  get_config,
  load_profile,
  load_team_selection,
  normalize_stat_value,
  reset_profile_stats_to_defaults
} from "./lobby_state.ts";

class MemoryStorage implements Storage {
  private readonly data = new Map<string, string>();

  get length(): number {
    return this.data.size;
  }

  clear(): void {
    this.data.clear();
  }

  getItem(key: string): string | null {
    return this.data.has(key) ? this.data.get(key)! : null;
  }

  key(index: number): string | null {
    return Array.from(this.data.keys())[index] ?? null;
  }

  removeItem(key: string): void {
    this.data.delete(key);
  }

  setItem(key: string, value: string): void {
    this.data.set(String(key), String(value));
  }
}

const memory_storage = new MemoryStorage();
Object.defineProperty(globalThis, "localStorage", {
  value: memory_storage,
  configurable: true,
  writable: true
});

function assert(condition: unknown, message: string): void {
  if (!condition) {
    throw new Error(`[lobby_state-test] ${message}`);
  }
}

function assert_equal<T>(actual: T, expected: T, message: string): void {
  if (actual !== expected) {
    throw new Error(`[lobby_state-test] ${message} (expected ${String(expected)}, got ${String(actual)})`);
  }
}

function assert_deep_equal(actual: unknown, expected: unknown, message: string): void {
  const actual_json = JSON.stringify(actual);
  const expected_json = JSON.stringify(expected);
  if (actual_json !== expected_json) {
    throw new Error(`[lobby_state-test] ${message} (expected ${expected_json}, got ${actual_json})`);
  }
}

function read_saved_json<T>(key: string): T | null {
  const raw = localStorage.getItem(key);
  if (!raw) {
    return null;
  }
  return JSON.parse(raw) as T;
}

function spec_for(id: string): MonsterCatalogEntry {
  const spec = MONSTER_BY_ID.get(id);
  if (!spec) {
    throw new Error(`[lobby_state-test] missing monster spec: ${id}`);
  }
  return spec;
}

function default_config(id: string): MonsterConfig {
  return coerce_config(spec_for(id), undefined, 3);
}

function reset_storage(): void {
  localStorage.clear();
}

function empty_ev(): EVSpread {
  return { hp: 0, atk: 0, def: 0, spe: 0 };
}

{
  assert_equal(normalize_stat_value("level", 999, 1), LEVEL_MAX, "normalize_stat_value should clamp level to max");
  assert_equal(normalize_stat_value("level", -20, 12), LEVEL_MIN, "normalize_stat_value should clamp level to min");
  assert_equal(normalize_stat_value("maxHp", -30, 100), 1, "normalize_stat_value should keep maxHp >= 1");
}

{
  reset_storage();
  const profile_key = "test:profile:migration";
  localStorage.setItem(
    profile_key,
    JSON.stringify({
      monsters: {
        night: default_config("night_sekyps"),
        ghost: default_config("armoth")
      }
    })
  );
  const loaded = load_profile(profile_key, MONSTER_BY_ID);
  assert(!!loaded.monsters.night_sekyps, "load_profile should migrate legacy monster ids");
  assert(!("night" in loaded.monsters), "load_profile should remove legacy id key");
  assert(!("ghost" in loaded.monsters), "load_profile should drop unknown monsters");
  const saved = read_saved_json<{ monsters: Record<string, unknown> }>(profile_key);
  assert(!!saved, "load_profile should persist migrated profile when changed");
  assert(saved?.monsters.night_sekyps !== undefined, "migrated profile should contain canonical id");
  assert(saved?.monsters.night === undefined, "migrated profile should not keep legacy id");
}

{
  reset_storage();
  const team_key = "test:team:migration";
  localStorage.setItem(team_key, JSON.stringify({ selected: ["night", "armoth", "missing", "kairus"] }));
  const enabled = new Set<string>(["night_sekyps", "armoth"]);
  const selected = load_team_selection(team_key, MONSTER_BY_ID, (id) => enabled.has(id), 3);
  assert_deep_equal(selected, ["night_sekyps", "armoth"], "load_team_selection should sanitize ids and disabled picks");
  const saved = read_saved_json<{ selected: string[] }>(team_key);
  assert_deep_equal(saved?.selected ?? null, ["night_sekyps", "armoth"], "load_team_selection should persist sanitized team");
}

{
  reset_storage();
  const profile_key = "test:profile:get_config:new";
  const profile = { monsters: {} as Record<string, MonsterConfig> };
  const created = get_config({
    monster_id: "armoth",
    roster_by_id: MONSTER_BY_ID,
    profile,
    profile_key,
    lobby_move_slots: 3
  });
  assert(profile.monsters.armoth === created, "get_config should cache created config in profile");
  assert_equal(created.moves.length, 3, "get_config should always return exactly 3 move slots");
  assert(!created.moves.includes("run"), "get_config should strip run from lobby move config");
  const saved = read_saved_json<{ monsters: Record<string, unknown> }>(profile_key);
  assert(saved?.monsters.armoth !== undefined, "get_config should persist a new monster config");
}

{
  reset_storage();
  const profile_key = "test:profile:get_config:coerce";
  const existing = {
    moves: ["cast", "bells_drum", "run"],
    passive: "type_buf_focus",
    stats: { level: 999, maxHp: 1, attack: 1, defense: 1, speed: 1 },
    ev: { hp: 33, atk: 12, def: 5, spe: 1 }
  } as MonsterConfig;
  const profile = {
    monsters: {
      night_sekyps: existing
    }
  };
  const coerced = get_config({
    monster_id: "night_sekyps",
    roster_by_id: MONSTER_BY_ID,
    profile,
    profile_key,
    lobby_move_slots: 3
  });
  assert_deep_equal(coerced.moves, ["sekyps", "kick", "none"], "get_config should coerce legacy/disallowed moves");
  assert_equal(coerced.passive, "none", "get_config should force passive to none in lobby");
  assert_equal(coerced.ev.hp, 0, "get_config should force HP EV to zero");
  assert(coerced.stats.level <= LEVEL_MAX && coerced.stats.level >= LEVEL_MIN, "get_config should clamp level bounds");
  const saved = read_saved_json<{ monsters: Record<string, MonsterConfig> }>(profile_key);
  assert_deep_equal(
    saved?.monsters.night_sekyps.moves ?? null,
    ["sekyps", "kick", "none"],
    "get_config should persist coerced moves"
  );
}

{
  reset_storage();
  const profile_key = "test:profile:reset_defaults";
  const specs = [spec_for("armoth"), spec_for("night_sekyps")];
  const armoth_base = default_config("armoth");
  const profile = {
    monsters: {
      armoth: {
        ...armoth_base,
        moves: ["none", "none", "none"],
        stats: { ...armoth_base.stats, level: LEVEL_MIN },
        ev: { hp: 0, atk: 200, def: 8, spe: 4 }
      },
      night_sekyps: default_config("night_sekyps")
    }
  };
  const changed = reset_profile_stats_to_defaults({
    profile,
    profile_key,
    roster: specs,
    lobby_move_slots: 3
  });
  assert_equal(changed, true, "reset_profile_stats_to_defaults should detect modified profile");
  assert_deep_equal(
    profile.monsters.armoth,
    default_config("armoth"),
    "reset_profile_stats_to_defaults should restore armoth defaults"
  );
  const changed_again = reset_profile_stats_to_defaults({
    profile,
    profile_key,
    roster: specs,
    lobby_move_slots: 3
  });
  assert_equal(changed_again, false, "reset_profile_stats_to_defaults should report unchanged on second pass");
}

{
  const selected = ["armoth", "kairus", "farien"];
  const result = build_team_selection({
    selected,
    roster_by_id: MONSTER_BY_ID,
    lobby_move_slots: 3,
    is_lobby_enabled_monster: () => true,
    monster_label: (id) => id,
    get_config: (id) => {
      const spec = spec_for(id);
      return {
        moves: ["none", "none", "none"],
        passive: "none",
        stats: { ...spec.stats },
        ev: id === "armoth" ? { hp: 0, atk: 253, def: 0, spe: 0 } : empty_ev()
      };
    }
  });
  assert_equal(result.team, null, "build_team_selection should reject invalid EV spreads");
  assert(typeof result.warning === "string" && result.warning.includes("0 and 252"), "build_team_selection should return EV warning");
}

{
  const selected = ["armoth", "kairus", "farien"];
  const config_by_id = new Map<string, MonsterConfig>();
  for (const id of selected) {
    const base = default_config(id);
    config_by_id.set(id, {
      ...base,
      moves: [...base.moves, "run"],
      stats: { ...base.stats, level: id === "armoth" ? 999 : base.stats.level }
    });
  }
  const result = build_team_selection({
    selected,
    roster_by_id: MONSTER_BY_ID,
    lobby_move_slots: 3,
    is_lobby_enabled_monster: () => true,
    monster_label: (id) => id,
    get_config: (id) => {
      const config = config_by_id.get(id);
      if (!config) {
        throw new Error(`[lobby_state-test] missing config for ${id}`);
      }
      return config;
    }
  });
  assert(result.team !== null, "build_team_selection should create a valid team");
  assert_equal(result.warning, null, "build_team_selection success path should not return warning");
  if (!result.team) {
    throw new Error("[lobby_state-test] expected build_team_selection team");
  }
  assert_equal(result.team.monsters.length, 3, "build_team_selection should include exactly 3 monsters");
  assert_equal(result.team.activeIndex, 0, "build_team_selection should start with activeIndex 0");
  assert_equal(result.team.monsters[0].moves.length, 3, "build_team_selection should trim moves to lobby slot count");
  assert_equal(result.team.monsters[0].stats.level, LEVEL_MAX, "build_team_selection should clamp over-level configs");
  const armoth_config = config_by_id.get("armoth");
  assert_equal(
    armoth_config?.stats.level,
    LEVEL_MAX,
    "build_team_selection should update source config with normalized stats"
  );
}

console.log("[lobby_state-test] ok");
