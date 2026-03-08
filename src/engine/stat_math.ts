import { mul_div_round, normalize_int } from "../int_math.ts";
import {
  FERVOR_CHAIN_MAX,
  FERVOR_MULTIPLIERS_100,
  STAT_MULTIPLIER_MAX_PERCENT,
  STAT_MULTIPLIER_MIN_PERCENT,
  STAT_STAGE_MAX,
  STAT_STAGE_MIN
} from "./constants.ts";

export function clamp_stat_stage(value: number): number {
  return Math.max(STAT_STAGE_MIN, Math.min(STAT_STAGE_MAX, value));
}

export function normalize_stat_stage(value: unknown, fallback: number): number {
  const raw = typeof value === "number" ? value : fallback;
  return clamp_stat_stage(normalize_int(raw, fallback, STAT_STAGE_MIN));
}

export function stage_ratio(stage: number): { numerator: number; denominator: number } {
  const normalized = clamp_stat_stage(stage);
  if (normalized >= 0) {
    return { numerator: 2 + normalized, denominator: 2 };
  }
  return { numerator: 2, denominator: 2 - normalized };
}

export function infer_stage_from_attack(current_attack: number, base_attack: number): number {
  if (!Number.isFinite(current_attack) || !Number.isFinite(base_attack) || base_attack <= 0) {
    return 0;
  }
  const inferred = Math.round((current_attack * 2) / base_attack - 2);
  return clamp_stat_stage(inferred);
}

export function stat_value_from_stage(base_value: number, stage: number): number {
  const ratio = stage_ratio(stage);
  return Math.max(0, mul_div_round(base_value, ratio.numerator, ratio.denominator));
}

export function attack_from_stage(base_attack: number, stage: number): number {
  return stat_value_from_stage(base_attack, stage);
}

export function clamp_stat_multiplier_percent(total_percent: number): number {
  return Math.max(STAT_MULTIPLIER_MIN_PERCENT, Math.min(STAT_MULTIPLIER_MAX_PERCENT, total_percent));
}

export function stat_multiplier_percent_from_delta(delta_percent: number): number {
  return clamp_stat_multiplier_percent(100 + delta_percent);
}

export function stat_value_from_delta_percent(base_value: number, delta_percent: number): number {
  return Math.max(0, mul_div_round(base_value, stat_multiplier_percent_from_delta(delta_percent), 100));
}

export function stat_value_from_delta_percent_and_stage(base_value: number, delta_percent: number, stage: number): number {
  const value_after_percent = stat_value_from_delta_percent(base_value, delta_percent);
  return stat_value_from_stage(value_after_percent, stage);
}

export function normalize_fervor_chain(value: unknown): number {
  const raw = typeof value === "number" ? value : 0;
  return Math.max(0, Math.min(FERVOR_CHAIN_MAX, normalize_int(raw, 0, 0)));
}

export function fervor_cast_streak_from_chain(chain: number): number {
  return Math.max(1, Math.min(FERVOR_MULTIPLIERS_100.length, normalize_fervor_chain(chain) + 1));
}

export function fervor_multiplier100_for_chain(chain: number): number {
  const streak = fervor_cast_streak_from_chain(chain);
  return FERVOR_MULTIPLIERS_100[streak - 1] ?? FERVOR_MULTIPLIERS_100[0];
}
