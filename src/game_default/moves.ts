import type { MoveCatalogEntry } from "./types.ts";

export const MOVE_CATALOG: readonly MoveCatalogEntry[] = [
  { id: "basic_attack", label: "Basic Attack", phaseId: "attack_01", attackMultiplier100: 100 },
  { id: "quick_attack", label: "Quick Attack", phaseId: "attack_01", attackMultiplier100: 66 },
  { id: "agility", label: "Agility", phaseId: "attack_01", attackMultiplier100: 0 },
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
    flatDamage: 35
  },
  { id: "screech", label: "Screech", phaseId: "attack_01", attackMultiplier100: 0 },
  { id: "endure", label: "Endure", phaseId: "guard", attackMultiplier100: 0 },
  { id: "protect", label: "Protect", phaseId: "guard", attackMultiplier100: 100 },
  { id: "none", label: "none", phaseId: "attack_01", attackMultiplier100: 100 }
];

export const MOVE_OPTIONS: string[] = MOVE_CATALOG.map((entry) => entry.id);

export const MOVE_LABELS: Record<string, string> = Object.fromEntries(
  MOVE_CATALOG.map((entry) => [entry.id, entry.label])
);

const MOVE_BY_ID_INTERNAL = new Map<string, MoveCatalogEntry>(
  MOVE_CATALOG.map((entry) => [entry.id, entry])
);

export const MOVE_BY_ID = MOVE_BY_ID_INTERNAL;

export function move_spec(move_id: string): MoveCatalogEntry {
  return MOVE_BY_ID_INTERNAL.get(move_id) ?? MOVE_BY_ID_INTERNAL.get("none")!;
}
