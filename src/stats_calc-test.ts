import {
  LEVEL_MAX,
  calc_hp_max,
  calc_non_hp_stat,
  ev_bonus,
  scaled_level_for_formula,
  validate_ev_spread
} from "./stats_calc.ts";

function assert(condition: unknown, message: string): void {
  if (!condition) {
    throw new Error(`[stats_calc-test] ${message}`);
  }
}

assert(ev_bonus(252) === 63, "evBonus(252) must be 63");
assert(ev_bonus(4) === 1, "evBonus(4) must be 1");
assert(ev_bonus(3) === 0, "evBonus(3) must be 0");
assert(LEVEL_MAX === 12, `LEVEL_MAX must be 12, got ${LEVEL_MAX}`);
assert(scaled_level_for_formula(12) === 12, "level 12 must map to formula level 12");
assert(scaled_level_for_formula(1) === 1, "level 1 must map to formula level 1");

const per_stat_error = validate_ev_spread({ hp: 253, atk: 0, def: 0, spe: 0 });
assert(per_stat_error !== null && per_stat_error.includes("hp") && per_stat_error.includes("0 and 252"), "253 EV must fail");

const total_error = validate_ev_spread({ hp: 252, atk: 252, def: 5, spe: 0 });
assert(total_error !== null && total_error.includes("<= 508"), "509+ total EV must fail");

const hp_max = calc_hp_max(80, 12, 252, 0);
assert(hp_max === 48, `hpMax floor case mismatch: expected 48, got ${hp_max}`);

const non_hp_stat = calc_non_hp_stat(100, 12, 252, 0, 1.1);
assert(non_hp_stat === 144, `non-HP floor case mismatch: expected 144, got ${non_hp_stat}`);

console.log("[stats_calc-test] ok");
