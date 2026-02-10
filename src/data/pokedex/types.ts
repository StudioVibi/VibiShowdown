import type { Stats } from "../../shared.ts";

export type DamageType = "scaled" | "true" | "flat";

export type MoveCatalogEntry = {
  id: string;
  label: string;
  phaseId: string;
  attackMultiplier100: number;
  attackMultiplierPerLevel100?: number;
  damageType?: DamageType;
  flatDamage?: number;
  recoilNumerator?: number;
  recoilDenominator?: number;
};

export type PassiveCatalogEntry = {
  id: string;
  label: string;
  aliases?: string[];
};

export type MonsterCatalogEntry = {
  id: string;
  name: string;
  role: string;
  stats: Stats;
  possibleMoves: string[];
  possiblePassives: string[];
  defaultMoves: string[];
  defaultPassive: string;
};
