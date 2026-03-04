import { MOVE_BY_ID, MOVE_CATALOG } from "./moves.ts";
import { PASSIVE_BY_ID } from "./passives.ts";
import type { MonsterCatalogEntry } from "./types.ts";
import { MONSTER_ROSTER } from "./mon.ts";
import { LEVEL_MAX, LEVEL_MIN } from "../stats_calc.ts";

function ensure(condition: unknown, message: string): void {
  if (!condition) {
    throw new Error(`[data] ${message}`);
  }
}

function ensure_int(value: number, message: string): void {
  ensure(Number.isInteger(value), message);
}

function ensure_valid_type(monster: MonsterCatalogEntry): void {
  ensure(
    monster.type === "buf" || monster.type === "def" || monster.type === "atk",
    `${monster.id}: invalid type ${monster.type}`
  );
}

const DEFAULT_MOVE_SLOTS = 4;
const ACTIVE_MOVE_SLOTS = 3;

export function assert_monster_integrity(monsters: readonly MonsterCatalogEntry[]): void {
  for (const move of MOVE_CATALOG) {
    const components = move.components ?? move.collateral ?? [];
    if (components.length === 0) {
      continue;
    }
    for (const collateral of components) {
      if (collateral.kind === "effect") {
        ensure_int(
          collateral.maxDurationTurns,
          `${move.id}: effect ${collateral.id} duration must be integer`
        );
        ensure(
          collateral.maxDurationTurns > 0,
          `${move.id}: effect ${collateral.id} duration must be > 0`
        );
        continue;
      }
      if (collateral.kind === "curse") {
        ensure(
          collateral.clearsOnSwitch === true,
          `${move.id}: curse ${collateral.id} must clear on switch`
        );
        continue;
      }
      if (collateral.kind === "buff_debuff") {
        ensure(collateral.id.trim().length > 0, `${move.id}: buff_debuff id is required`);
        ensure_int(
          collateral.deltaPercent,
          `${move.id}: buff_debuff ${collateral.id} deltaPercent must be integer`
        );
        ensure(
          collateral.clearsOnSwitch === true,
          `${move.id}: buff_debuff ${collateral.id} must clear on switch`
        );
        continue;
      }
      if (collateral.kind === "instant") {
        ensure(collateral.id.trim().length > 0, `${move.id}: instant id is required`);
        continue;
      }
    }
  }

  const monster_ids = new Set<string>();

  for (const monster of monsters) {
    ensure(monster.id.length > 0, "monster id is required");
    ensure(!monster_ids.has(monster.id), `duplicate monster id: ${monster.id}`);
    monster_ids.add(monster.id);

    ensure(
      monster.defaultMoves.length === DEFAULT_MOVE_SLOTS,
      `${monster.id}: defaultMoves must contain exactly ${DEFAULT_MOVE_SLOTS} entries`
    );
    ensure_valid_type(monster);

    const possible_moves = new Set(monster.possibleMoves);
    ensure(possible_moves.size > 0, `${monster.id}: possibleMoves cannot be empty`);
    ensure(possible_moves.has("run"), `${monster.id}: possibleMoves must include run`);

    for (const move_id of monster.possibleMoves) {
      ensure(MOVE_BY_ID.has(move_id), `${monster.id}: unknown move in possibleMoves: ${move_id}`);
    }

    const move_dedup = new Set<string>();
    for (let i = 0; i < monster.defaultMoves.length; i++) {
      const move_id = monster.defaultMoves[i]!;
      ensure(MOVE_BY_ID.has(move_id), `${monster.id}: unknown move in defaultMoves: ${move_id}`);
      ensure(possible_moves.has(move_id), `${monster.id}: default move not allowed: ${move_id}`);

      if (i === DEFAULT_MOVE_SLOTS - 1) {
        ensure(move_id === "run", `${monster.id}: last default move must be run`);
        continue;
      }

      ensure(move_id !== "run", `${monster.id}: run is only allowed in last default move slot`);
      if (move_id !== "none") {
        ensure(!move_dedup.has(move_id), `${monster.id}: duplicate default move: ${move_id}`);
        move_dedup.add(move_id);
      }
    }

    const active_default_moves = monster.defaultMoves
      .slice(0, ACTIVE_MOVE_SLOTS)
      .filter((move_id) => move_id !== "none");
    ensure(
      active_default_moves.length >= 2,
      `${monster.id}: defaultMoves must contain at least 2 active abilities in first ${ACTIVE_MOVE_SLOTS} slots`
    );

    ensure(monster.possiblePassives.length > 0, `${monster.id}: possiblePassives cannot be empty`);
    const possible_passives = new Set<string>();
    for (const passive_id of monster.possiblePassives) {
      ensure(PASSIVE_BY_ID.has(passive_id), `${monster.id}: unknown passive in possiblePassives: ${passive_id}`);
      possible_passives.add(passive_id);
    }
    ensure(
      PASSIVE_BY_ID.has(monster.defaultPassive),
      `${monster.id}: unknown default passive: ${monster.defaultPassive}`
    );
    ensure(
      possible_passives.has(monster.defaultPassive),
      `${monster.id}: default passive not allowed: ${monster.defaultPassive}`
    );

    ensure_int(monster.stats.level, `${monster.id}: level must be integer`);
    ensure_int(monster.stats.maxHp, `${monster.id}: maxHp must be integer`);
    ensure_int(monster.stats.attack, `${monster.id}: attack must be integer`);
    ensure_int(monster.stats.defense, `${monster.id}: defense must be integer`);
    ensure_int(monster.stats.speed, `${monster.id}: speed must be integer`);
    ensure(monster.stats.level > 0, `${monster.id}: level must be > 0`);
    ensure(
      monster.stats.level >= LEVEL_MIN && monster.stats.level <= LEVEL_MAX,
      `${monster.id}: level must be between ${LEVEL_MIN} and ${LEVEL_MAX}`
    );
    ensure(monster.stats.maxHp > 0, `${monster.id}: maxHp must be > 0`);
    ensure(monster.stats.attack >= 0, `${monster.id}: attack must be >= 0`);
    ensure(monster.stats.defense >= 0, `${monster.id}: defense must be >= 0`);
    ensure(monster.stats.speed >= 0, `${monster.id}: speed must be >= 0`);
  }
}

function is_integrity_entrypoint(): boolean {
  if (typeof process === "undefined" || !Array.isArray(process.argv)) {
    return false;
  }
  const entry = process.argv[1];
  if (typeof entry !== "string" || entry.length === 0) {
    return false;
  }
  const normalized = entry.replace(/\\/g, "/");
  return normalized.endsWith("/src/data/integrity.ts") || normalized.endsWith("src/data/integrity.ts");
}

if (is_integrity_entrypoint()) {
  assert_monster_integrity(MONSTER_ROSTER);
  console.log(`[integrity] ok (${MONSTER_ROSTER.length} monsters)`);
}
