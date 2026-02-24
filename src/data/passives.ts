import type { PassiveCatalogEntry } from "./types.ts";

export const PASSIVE_CATALOG: readonly PassiveCatalogEntry[] = [
  { id: "none", label: "none", kind: "none", components: [] },
  {
    id: "clear_body",
    label: "Clear Body [Instant]",
    kind: "instant",
    components: [{ kind: "instant", id: "clear_body", target: "self" }]
  }
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
