import type { CurseCollateralId, EffectCollateralId } from "../data/types.ts";
import type { MonsterState, MoveId, PlayerSlot } from "../shared.ts";

export type Phase = {
  id: string;
  name: string;
  order: number;
  initiative: Array<keyof Pick<MonsterState, "speed" | "attack" | "hp" | "defense">>;
};

export type Action =
  | { player: PlayerSlot; type: "switch"; phase: string; targetIndex: number }
  | { player: PlayerSlot; type: "run"; phase: string }
  | {
      player: PlayerSlot;
      type: "move";
      phase: string;
      moveId: MoveId;
      moveIndex: number;
    };

export type MatchProgress = "continue" | "stop_turn" | "ended";

export const INITIATIVE_DEFAULT: Phase["initiative"] = ["speed", "attack", "hp", "defense"];
export const INITIATIVE_NONE: Phase["initiative"] = [];
export const INITIATIVE_WITHOUT_SPEED: Phase["initiative"] = ["attack", "hp", "defense"];

export const PHASES: Phase[] = [
  { id: "switch", name: "Switch", order: 0, initiative: INITIATIVE_DEFAULT },
  { id: "guard", name: "Guard", order: 1, initiative: INITIATIVE_DEFAULT },
  { id: "immune", name: "Immune", order: 1.5, initiative: INITIATIVE_DEFAULT },
  { id: "attack_01", name: "Attack 01", order: 2, initiative: INITIATIVE_DEFAULT },
  { id: "run", name: "Run", order: 3, initiative: INITIATIVE_NONE }
];

export const END_PHASE_ID = "ending_turn";
export const SLOT_ORDER = ["player1", "player2"] as const;
export const END_TURN_EFFECT_ORDER = [
  "focus_punch",
  "rejuvenation_reactive",
  "wish",
  "leech_life",
  "rejuvenation_regen",
  "type_regen",
  "happiness_apply"
] as const;
export type EndTurnEffectId = (typeof END_TURN_EFFECT_ORDER)[number];

export const TAUNT_BLOCKED_MOVE_IDS = new Set([
  "none",
  "agility",
  "run",
  "switch_sovietico",
  "team_cure",
  "bait",
  "wish",
  "rejuvenation",
  "power",
  "spikes",
  "recover",
  "heal",
  "meditate",
  "belly_drum",
  "screech",
  "taunt",
  "pain_split",
  "leech_life",
  "sekyps",
  "hook"
]);

export const STAT_STAGE_MIN = -6;
export const STAT_STAGE_MAX = 6;
export const POWER_ATTACK_STAGE_PER_CAST = 1;
export const MEDITATE_ATTACK_STAGE_PER_CAST = 2;
export const TYPE_PASSIVE_ATK_TRUE_DAMAGE = 50;
export const THROW_FIXED_OFFENSE_TERM = 90 * 90;
export const TYPE_PASSIVE_DEF_ARMOR_STACK_MAX = 5;
export const TYPE_PASSIVE_DEF_ARMOR_REDUCTION_PER_STACK_PERCENT = 10;
export const TYPE_PASSIVE_BUF_REGEN_PER_STACK = 5;
export const STAT_MULTIPLIER_MIN_PERCENT = 25;
export const STAT_MULTIPLIER_MAX_PERCENT = 400;
export const MSPE_VALUE_GOAL = 500;
export const MSPE_GAP_GOAL_PERCENT = 33;
export const RUN_MSPE_GAIN_PERCENT = 10;
export const HOOK_RUN_MSPE_REDUCTION_PERCENT = 20;
export const HOOK_EXPOSURE_INCOMING_DAMAGE_MULTIPLIER_PERCENT = 166;
export const HOOK_SELF_MSPE_REDUCTION_PERCENT = 10;
export const SEKYPS_DAMAGE_PER_STACK = 24;
export const REJUVENATION_REGEN_FLAT_PER_STACK = 30;
export const REJUVENATION_REGEN_STACK_MAX = 3;
export const REJUVENATION_REGEN_FLAT_MAX = REJUVENATION_REGEN_FLAT_PER_STACK * REJUVENATION_REGEN_STACK_MAX;
export const FERVOR_CHAIN_MAX = 2;
export const FERVOR_MULTIPLIERS_100 = [50, 100, 200] as const;
export const HAPPINESS_DURATION_AFTER_ENDING_APPLY = 2;
export const TYPE_BUF_REGEN_HEAL_BUFF_ID = "type_buf_regen";
export const REJUVENATION_REGEN_HEAL_BUFF_ID = "rejuvenation_regen";
export const HEAL_MOVE_HEAL_BUFF_ID = "heal_move";
export const RECOVER_MOVE_HEAL_BUFF_ID = "recover_move";

export const EFFECT_IDS: readonly EffectCollateralId[] = [
  "confuse",
  "sleep",
  "stun",
  "taunt",
  "nocaute",
  "immobilize",
  "weakness",
  "deterioration",
  "paralyse",
  "silence",
  "rejuvenation"
] as const;
export const EFFECT_ID_SET = new Set<string>(EFFECT_IDS);

export const CURSE_IDS: readonly CurseCollateralId[] = [
  "madness",
  "frustration",
  "happiness",
  "leech_seed",
  "sekyps",
  "mirror",
  "destiny_bond",
  "endure"
] as const;
export const CURSE_ID_SET = new Set<string>(CURSE_IDS);

export const EFFECT_LABELS: Record<EffectCollateralId, string> = {
  confuse: "Confuse",
  sleep: "Sleep",
  stun: "Stun",
  taunt: "Taunt",
  nocaute: "Nocaute",
  immobilize: "Immobilize",
  weakness: "Weakness",
  deterioration: "Deterioration",
  paralyse: "Paralyse",
  silence: "Silence",
  rejuvenation: "Rejuvenation"
};

export const CURSE_LABELS: Record<CurseCollateralId, string> = {
  madness: "Madness",
  frustration: "Frustration",
  happiness: "Happiness",
  leech_seed: "Leech Seed",
  sekyps: "Sekyps",
  mirror: "Mirror",
  destiny_bond: "Destiny Bond",
  endure: "Endure"
};

export const NEGATIVE_STAT_EFFECT_ID_SET = new Set<EffectCollateralId>(["weakness", "deterioration", "paralyse"]);
export const ATTACK_STAGE_BUFF_IDS = new Set<string>([
  "power_attack_up",
  "power_attack_stage_up",
  "meditate_attack_up",
  "belly_drum_attack_up"
]);
export const POWER_ATTACK_STAGE_BUFF_IDS = new Set<string>(["power_attack_up", "power_attack_stage_up"]);
