import type {
  CollateralKind,
  CollateralRank,
  CurseCollateralId,
  EffectCollateralId
} from "./types.ts";

export type EffectCollateralTemplate = {
  id: EffectCollateralId;
  label: string;
  rank: CollateralRank;
  summary: string;
};

export type CurseCollateralTemplate = {
  id: CurseCollateralId;
  label: string;
  rank: CollateralRank;
  summary: string;
};

export const COLLATERAL_KIND_OPTIONS: readonly CollateralKind[] = [
  "effect",
  "buff_debuff",
  "curse"
] as const;

// Effect taxonomy. Runtime behavior exists in engine for effect collaterals.
export const EFFECT_COLLATERAL_TEMPLATES: readonly EffectCollateralTemplate[] = [
  { id: "confuse", label: "Confuse", rank: "S", summary: "Impede moves e switch." },
  { id: "sleep", label: "Sleep", rank: "S", summary: "Impede skills e moves." },
  { id: "stun", label: "Stun", rank: "A", summary: "Impede moves." },
  { id: "happiness", label: "Happiness", rank: "B", summary: "Permite apenas o ultimo move utilizado." },
  { id: "taunt", label: "Taunt", rank: "B", summary: "Forca moves de ataque." },
  { id: "frustration", label: "Frustration", rank: "B", summary: "Bloqueia o ultimo move utilizado." },
  { id: "nocaute", label: "Nocaute", rank: "C", summary: "Forca switch." },
  { id: "immobilize", label: "Immobilize", rank: "C", summary: "Impede switch." },
  { id: "weakness", label: "Weakness", rank: "C", summary: "Remove strength." },
  { id: "deterioration", label: "Deterioration", rank: "C", summary: "Remove defense." },
  { id: "paralyse", label: "Paralyse", rank: "C", summary: "Remove speed." },
  { id: "silence", label: "Silence", rank: "C", summary: "Impede skills." }
] as const;

// Curse taxonomy. Runtime currently supports application/removal and Leech Seed tick behavior.
export const CURSE_COLLATERAL_TEMPLATES: readonly CurseCollateralTemplate[] = [
  { id: "madness", label: "Madness", rank: "?", summary: "Maldição removida ao trocar." },
  { id: "leech_seed", label: "Leech Seed", rank: "?", summary: "Maldição removida ao trocar." },
  { id: "destiny_bond", label: "Destiny Bond", rank: "?", summary: "Maldição removida ao trocar." },
  { id: "endure", label: "Endure", rank: "?", summary: "Maldição removida ao trocar." }
] as const;
