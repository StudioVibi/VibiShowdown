import type { MoveCatalogEntry } from "./types.ts";

export const MOVE_CATALOG: readonly MoveCatalogEntry[] = [
  { id: "quick_attack", label: "Quick Attack", phaseId: "attack_01", attackMultiplier100: 66 },
  { id: "punch", label: "Punch", phaseId: "attack_01", attackMultiplier100: 93 },
  { id: "power", label: "Power", phaseId: "attack_01", attackMultiplier100: 0 },
  { id: "fervor", label: "Fervor", phaseId: "attack_01", attackMultiplier100: 50 },
  { id: "hook", label: "Hook", phaseId: "attack_01", attackMultiplier100: 0 },
  { id: "kick", label: "Kick", phaseId: "attack_01", attackMultiplier100: 120 },
  { id: "throw", label: "Throw", phaseId: "attack_01", attackMultiplier100: 100 },
  { id: "agility", label: "Agility", phaseId: "attack_01", attackMultiplier100: 0 },
  { id: "run", label: "Run", phaseId: "attack_01", attackMultiplier100: 0 },
  { id: "wish", label: "Wish", phaseId: "attack_01", attackMultiplier100: 0 },
  { id: "rejuvenation", label: "Rejuvenation", phaseId: "attack_01", attackMultiplier100: 0 },
  { id: "switch_sovietico", label: "Switch Sovietico", phaseId: "attack_01", attackMultiplier100: 0 },
  { id: "team_cure", label: "Team Cure", phaseId: "attack_01", attackMultiplier100: 0 },
  { id: "bait", label: "Bait", phaseId: "attack_01", attackMultiplier100: 0 },
  { id: "belly_drum", label: "Belly Drum", phaseId: "attack_01", attackMultiplier100: 0 },
  {
    id: "return",
    label: "Return",
    phaseId: "attack_01",
    attackMultiplier100: 72,
    attackMultiplierPerLevel100: 4
  },
  {
    id: "double_edge",
    label: "Double-Edge",
    phaseId: "attack_01",
    attackMultiplier100: 120,
    recoilNumerator: 1,
    recoilDenominator: 3
  },
  {
    id: "seismic_toss",
    label: "Seismic Toss",
    phaseId: "attack_01",
    attackMultiplier100: 100,
    damageType: "flat",
    flatDamage: 50
  },
  {
    id: "leech_life",
    label: "Leech Life",
    phaseId: "attack_01",
    attackMultiplier100: 0,
    components: [{ kind: "curse", id: "leech_seed", clearsOnSwitch: true }]
  },
  {
    id: "sekyps",
    label: "Sekyps",
    phaseId: "attack_01",
    attackMultiplier100: 0,
    components: [{ kind: "curse", id: "sekyps", clearsOnSwitch: true }]
  },
  {
    id: "mirror",
    label: "Mirror",
    phaseId: "attack_01",
    attackMultiplier100: 0,
    components: [{ kind: "curse", id: "mirror", clearsOnSwitch: true }]
  },
  { id: "focus_punch", label: "Focus Punch", phaseId: "attack_01", attackMultiplier100: 150 },
  { id: "pain_split", label: "Pain Split", phaseId: "attack_01", attackMultiplier100: 0 },
  { id: "screech", label: "Screech", phaseId: "attack_01", attackMultiplier100: 0 },
  {
    id: "taunt",
    label: "Taunt",
    phaseId: "attack_01",
    attackMultiplier100: 0,
    components: [{ kind: "effect", id: "taunt", maxDurationTurns: 2 }]
  },
  { id: "spikes", label: "Spikes", phaseId: "attack_01", attackMultiplier100: 0 },
  { id: "recover", label: "Recover", phaseId: "attack_01", attackMultiplier100: 0 },
  { id: "heal", label: "Heal", phaseId: "attack_01", attackMultiplier100: 0 },
  { id: "mega_punch", label: "Mega Punch", phaseId: "attack_01", attackMultiplier100: 100, damageType: "flat", flatDamage: 20 },
  { id: "meditate", label: "Meditate", phaseId: "attack_01", attackMultiplier100: 0 },
  { id: "ki_blast", label: "Ki Blast", phaseId: "attack_01", attackMultiplier100: 0 },
  { id: "endure", label: "Endure", phaseId: "guard", attackMultiplier100: 0 },
  { id: "protect", label: "Protect", phaseId: "guard", attackMultiplier100: 100 },
  { id: "special_protect", label: "Special Protect", phaseId: "immune", attackMultiplier100: 0 },
  { id: "none", label: "none", phaseId: "attack_01", attackMultiplier100: 100 }
];

export const MOVE_OPTIONS: string[] = MOVE_CATALOG.map((entry) => entry.id);

const MOVE_ALIASES: Record<string, string> = {
  bells_drum: "belly_drum",
  cast: "throw"
};

export const MOVE_LABELS: Record<string, string> = Object.fromEntries(
  MOVE_CATALOG.map((entry) => [entry.id, entry.label])
);
MOVE_LABELS.bells_drum = "Belly Drum";
MOVE_LABELS.cast = "Throw";

const MOVE_BY_ID_INTERNAL = new Map<string, MoveCatalogEntry>(
  MOVE_CATALOG.map((entry) => [entry.id, entry])
);
for (const [legacy_id, canonical_id] of Object.entries(MOVE_ALIASES)) {
  const canonical = MOVE_BY_ID_INTERNAL.get(canonical_id);
  if (canonical) {
    MOVE_BY_ID_INTERNAL.set(legacy_id, canonical);
  }
}

export const MOVE_BY_ID = MOVE_BY_ID_INTERNAL;

export function move_spec(move_id: string): MoveCatalogEntry {
  return MOVE_BY_ID_INTERNAL.get(move_id) ?? MOVE_BY_ID_INTERNAL.get("none")!;
}
