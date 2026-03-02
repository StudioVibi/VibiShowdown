import type { MonsterType, Stats } from "../shared.ts";

export type DamageType = "scaled" | "true" | "flat";

export type CollateralKind = "effect" | "buff_debuff" | "curse" | "instant";

export type CollateralRank = "S" | "A" | "B" | "C" | "?";

export type EffectCollateralId =
  | "confuse"
  | "sleep"
  | "stun"
  | "happiness"
  | "taunt"
  | "frustration"
  | "nocaute"
  | "immobilize"
  | "weakness"
  | "deterioration"
  | "paralyse"
  | "silence"
  | "rejuvenation";

export type CurseCollateralId = "madness" | "leech_seed" | "destiny_bond" | "endure" | "sekyps";

export type InstantCollateralId = "clear_body" | string;

export type BuffDebuffTarget = "self" | "opponent";

export type BuffDebuffStat = "attack" | "defense" | "speed";

export type EffectCollateral = {
  kind: "effect";
  id: EffectCollateralId;
  rank?: CollateralRank;
  maxDurationTurns: number;
  target?: BuffDebuffTarget;
};

export type BuffDebuffCollateral = {
  kind: "buff_debuff";
  id: string;
  target: BuffDebuffTarget;
  stat: BuffDebuffStat;
  deltaPercent: number;
  clearsOnSwitch: boolean;
};

export type CurseCollateral = {
  kind: "curse";
  id: CurseCollateralId;
  rank?: CollateralRank;
  clearsOnSwitch: true;
};

export type InstantCollateral = {
  kind: "instant";
  id: InstantCollateralId;
  target?: BuffDebuffTarget;
};

export type MoveCollateral = EffectCollateral | BuffDebuffCollateral | CurseCollateral | InstantCollateral;

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
  components?: MoveCollateral[];
  collateral?: MoveCollateral[];
};

export type PassiveCatalogEntry = {
  id: string;
  label: string;
  kind?: "none" | "instant";
  components?: MoveCollateral[];
  aliases?: string[];
};

export type MonsterCatalogEntry = {
  id: string;
  name: string;
  role: string;
  type: MonsterType;
  stats: Stats;
  possibleMoves: string[];
  possiblePassives: string[];
  defaultMoves: string[];
  defaultPassive: string;
};
