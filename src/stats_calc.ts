export type EVSpread = {
  hp: number;
  atk: number;
  def: number;
  spe: number;
};

export type IVSpread = {
  hp: number;
  atk: number;
  def: number;
  spe: number;
};

export type NatureSpread = {
  atk: number;
  def: number;
  spe: number;
};

export type BaseStats = {
  hp: number;
  atk: number;
  def: number;
  spe: number;
};

export type FinalStats = {
  hpMax: number;
  atk: number;
  def: number;
  spe: number;
};

export const EV_PER_STAT_MAX = 252;
export const EV_TOTAL_MAX = 508;
export const LEVEL_MIN = 1;
export const LEVEL_MAX = 100;

export function empty_ev_spread(): EVSpread {
  return { hp: 0, atk: 0, def: 0, spe: 0 };
}

export function empty_iv_spread(): IVSpread {
  return { hp: 0, atk: 0, def: 0, spe: 0 };
}

export function neutral_nature(): NatureSpread {
  return { atk: 1, def: 1, spe: 1 };
}

export function ev_bonus(ev: number): number {
  return Math.floor(ev / 4);
}

export function validate_ev_spread(ev: EVSpread): string | null {
  const values: Array<[keyof EVSpread, number]> = [
    ["hp", ev.hp],
    ["atk", ev.atk],
    ["def", ev.def],
    ["spe", ev.spe]
  ];
  for (const [key, value] of values) {
    if (!Number.isInteger(value)) {
      return `EV ${key} must be integer`;
    }
    if (value < 0 || value > EV_PER_STAT_MAX) {
      return `EV ${key} must be between 0 and ${EV_PER_STAT_MAX}`;
    }
  }
  const total = values.reduce((sum, [, value]) => sum + value, 0);
  if (total > EV_TOTAL_MAX) {
    return `EV total must be <= ${EV_TOTAL_MAX} (got ${total})`;
  }
  return null;
}

export function calc_hp_max(base_hp: number, level: number, ev_hp: number, iv_hp: number): number {
  return Math.floor(((2 * base_hp + iv_hp + ev_bonus(ev_hp)) * level) / 100) + level + 10;
}

export function calc_non_hp_stat(base: number, level: number, ev: number, iv: number, nature: number): number {
  const term = Math.floor(((2 * base + iv + ev_bonus(ev)) * level) / 100) + 5;
  return Math.floor(term * nature);
}

export function calc_final_stats(
  base: BaseStats,
  level: number,
  ev: EVSpread,
  iv: IVSpread = empty_iv_spread(),
  nature: NatureSpread = neutral_nature()
): FinalStats {
  return {
    hpMax: calc_hp_max(base.hp, level, ev.hp, iv.hp),
    atk: calc_non_hp_stat(base.atk, level, ev.atk, iv.atk, nature.atk),
    def: calc_non_hp_stat(base.def, level, ev.def, iv.def, nature.def),
    spe: calc_non_hp_stat(base.spe, level, ev.spe, iv.spe, nature.spe)
  };
}
