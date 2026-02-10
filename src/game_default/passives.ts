import type { PassiveCatalogEntry } from "./types.ts";
import type { EventLog, MonsterState, PlayerSlot } from "../shared.ts";

export const PASSIVE_CATALOG: readonly PassiveCatalogEntry[] = [
  { id: "none", label: "none" },
  { id: "leftovers", label: "Leftovers", aliases: ["regen_5pct"] },
  { id: "choice_band", label: "Choice Band" }
];

export const PASSIVE_OPTIONS: string[] = PASSIVE_CATALOG.map((entry) => entry.id);

export const PASSIVE_LABELS: Record<string, string> = Object.fromEntries(
  PASSIVE_CATALOG.flatMap((entry) => {
    const rows: Array<[string, string]> = [[entry.id, entry.label]];
    for (const alias of entry.aliases ?? []) {
      rows.push([alias, entry.label]);
    }
    return rows;
  })
);

const PASSIVE_BY_ID_INTERNAL = new Map<string, PassiveCatalogEntry>();
for (const entry of PASSIVE_CATALOG) {
  PASSIVE_BY_ID_INTERNAL.set(entry.id, entry);
  for (const alias of entry.aliases ?? []) {
    PASSIVE_BY_ID_INTERNAL.set(alias, entry);
  }
}

export const PASSIVE_BY_ID = PASSIVE_BY_ID_INTERNAL;

export function normalize_passive_id(passive_id: string): string {
  return PASSIVE_BY_ID_INTERNAL.get(passive_id)?.id ?? passive_id;
}

export function passive_spec(passive_id: string): PassiveCatalogEntry {
  return PASSIVE_BY_ID_INTERNAL.get(passive_id) ?? PASSIVE_BY_ID_INTERNAL.get("none")!;
}

export type PassiveTurnEffectContext = {
  slot: PlayerSlot;
  monster: MonsterState;
  turn: number;
  log: EventLog[];
  hp_changed: WeakSet<MonsterState>;
};

type PassiveTurnEffect = (context: PassiveTurnEffectContext) => void;

function apply_leftovers(context: PassiveTurnEffectContext): void {
  const { monster } = context;
  const heal = Math.floor(monster.maxHp * 0.06);
  if (heal <= 0) {
    return;
  }
  const before = monster.hp;
  monster.hp = Math.min(monster.maxHp, monster.hp + heal);
  const gained = monster.hp - before;
  if (gained <= 0) {
    return;
  }
  context.hp_changed.add(monster);
  context.log.push({
    type: "passive_heal",
    turn: context.turn,
    summary: `${context.slot} Leftovers +${gained} HP`,
    data: { slot: context.slot, amount: gained, passive: "leftovers" }
  });
}

const NOOP_PASSIVE: PassiveTurnEffect = () => {};

const PASSIVE_TURN_EFFECTS: Record<string, PassiveTurnEffect> = {
  none: NOOP_PASSIVE,
  leftovers: apply_leftovers,
  choice_band: NOOP_PASSIVE
};

export function apply_passive_turn_effect(passive_id: string, context: PassiveTurnEffectContext): void {
  const normalized = passive_spec(passive_id).id;
  const effect = PASSIVE_TURN_EFFECTS[normalized] ?? NOOP_PASSIVE;
  effect(context);
}
