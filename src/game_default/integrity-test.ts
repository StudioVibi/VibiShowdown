import { MONSTER_ROSTER } from "./pokemon.ts";
import { assert_monster_integrity } from "./integrity.ts";

assert_monster_integrity(MONSTER_ROSTER);
console.log(`[integrity] ok (${MONSTER_ROSTER.length} monsters)`);
