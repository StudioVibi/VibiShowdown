import type { MonsterType, Stats } from "../shared.ts";

export type DamageType = "scaled" | "true" | "flat";

// Kind define o canal técnico de execução do componente:
// - effect: status temporário com duração em turnos (ex.: taunt, stun)
// - buff_debuff: modificador de status numérico (ATK/DEF/DEX) com delta percentual
// - curse: maldição com regra própria de tick/remoção (ex.: leech_seed, sekyps)
// - instant: resolução imediata sem estado persistente
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

export type CurseCollateralId = "madness" | "leech_seed" | "destiny_bond" | "endure" | "sekyps" | "mirror";

export type InstantCollateralId = "clear_body" | string;

export type BuffDebuffTarget = "self" | "opponent";

export type BuffDebuffStat = "attack" | "defense" | "speed";

export type EffectCollateral = {
  // Status controlado por duração (remainingTurns) no runtime.
  kind: "effect";
  id: EffectCollateralId;
  rank?: CollateralRank;
  maxDurationTurns: number;
  target?: BuffDebuffTarget;
};

export type BuffDebuffCollateral = {
  // Modificador de atributo numérico (deltaPercent) aplicado ao alvo.
  kind: "buff_debuff";
  id: string;
  target: BuffDebuffTarget;
  stat: BuffDebuffStat;
  deltaPercent: number;
  clearsOnSwitch: boolean;
};

export type CurseCollateral = {
  // Maldição com regras de efeito contínuo/stack conforme id.
  kind: "curse";
  id: CurseCollateralId;
  rank?: CollateralRank;
  clearsOnSwitch: true;
};

export type InstantCollateral = {
  // Efeito pontual: executa no momento e não persiste em lista ativa.
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
