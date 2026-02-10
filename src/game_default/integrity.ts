import { MOVE_BY_ID } from "./moves.ts";
import { PASSIVE_BY_ID, normalize_passive_id } from "./passives.ts";
import type { MonsterCatalogEntry } from "./types.ts";

function ensure(condition: unknown, message: string): void {
  if (!condition) {
    throw new Error(`[game_default] ${message}`);
  }
}

export function assert_monster_integrity(monsters: readonly MonsterCatalogEntry[]): void {
  const monster_ids = new Set<string>();

  for (const monster of monsters) {
    ensure(monster.id.length > 0, "monster id is required");
    ensure(!monster_ids.has(monster.id), `duplicate monster id: ${monster.id}`);
    monster_ids.add(monster.id);

    ensure(monster.defaultMoves.length === 4, `${monster.id}: defaultMoves must contain exactly 4 entries`);

    const possible_moves = new Set(monster.possibleMoves);
    ensure(possible_moves.size > 0, `${monster.id}: possibleMoves cannot be empty`);

    for (const move_id of monster.possibleMoves) {
      ensure(MOVE_BY_ID.has(move_id), `${monster.id}: unknown move in possibleMoves: ${move_id}`);
    }

    const move_dedup = new Set<string>();
    for (const move_id of monster.defaultMoves) {
      ensure(MOVE_BY_ID.has(move_id), `${monster.id}: unknown move in defaultMoves: ${move_id}`);
      ensure(possible_moves.has(move_id), `${monster.id}: default move not allowed: ${move_id}`);
      if (move_id !== "none") {
        ensure(!move_dedup.has(move_id), `${monster.id}: duplicate default move: ${move_id}`);
        move_dedup.add(move_id);
      }
    }

    ensure(monster.possiblePassives.length > 0, `${monster.id}: possiblePassives cannot be empty`);

    const possible_passives = new Set(monster.possiblePassives.map(normalize_passive_id));
    for (const passive_id of monster.possiblePassives) {
      ensure(PASSIVE_BY_ID.has(passive_id), `${monster.id}: unknown passive in possiblePassives: ${passive_id}`);
    }

    const normalized_default = normalize_passive_id(monster.defaultPassive);
    ensure(PASSIVE_BY_ID.has(monster.defaultPassive), `${monster.id}: unknown default passive: ${monster.defaultPassive}`);
    ensure(
      possible_passives.has(normalized_default),
      `${monster.id}: default passive not allowed: ${monster.defaultPassive}`
    );

    ensure(monster.stats.level > 0, `${monster.id}: level must be > 0`);
    ensure(monster.stats.maxHp > 0, `${monster.id}: maxHp must be > 0`);
    ensure(monster.stats.attack >= 0, `${monster.id}: attack must be >= 0`);
    ensure(monster.stats.defense >= 0, `${monster.id}: defense must be >= 0`);
    ensure(monster.stats.speed >= 0, `${monster.id}: speed must be >= 0`);
  }
}
