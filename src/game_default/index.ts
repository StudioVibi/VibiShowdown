import { MOVE_BY_ID, MOVE_CATALOG, MOVE_LABELS, MOVE_OPTIONS, move_spec } from "./moves.ts";
import { PASSIVE_BY_ID, PASSIVE_CATALOG, PASSIVE_LABELS, PASSIVE_OPTIONS, normalize_passive_id, passive_spec } from "./passives.ts";
import { MONSTER_BY_ID, MONSTER_ROSTER } from "./pokemon.ts";
import type { MonsterCatalogEntry, MoveCatalogEntry, PassiveCatalogEntry } from "./types.ts";
import { assert_monster_integrity } from "./integrity.ts";

assert_monster_integrity(MONSTER_ROSTER);

export {
  MOVE_BY_ID,
  MOVE_CATALOG,
  MOVE_LABELS,
  MOVE_OPTIONS,
  MONSTER_BY_ID,
  MONSTER_ROSTER,
  PASSIVE_BY_ID,
  PASSIVE_CATALOG,
  PASSIVE_LABELS,
  PASSIVE_OPTIONS,
  move_spec,
  normalize_passive_id,
  passive_spec
};

export type { MonsterCatalogEntry, MoveCatalogEntry, PassiveCatalogEntry };
