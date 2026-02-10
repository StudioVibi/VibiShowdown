import { MOVE_OPTIONS } from "./moves.ts";
import { PASSIVE_OPTIONS } from "./passives.ts";
import type { MonsterCatalogEntry } from "./types.ts";

function all_move_options(): string[] {
  return MOVE_OPTIONS.slice();
}

function all_passive_options(): string[] {
  return PASSIVE_OPTIONS.slice();
}

export const MONSTER_ROSTER: readonly MonsterCatalogEntry[] = [
  {
    id: "babydragon",
    name: "Baby Dragon TR",
    role: "Return Tester",
    stats: { level: 7, maxHp: 100, attack: 100, defense: 10, speed: 20 },
    possibleMoves: all_move_options(),
    possiblePassives: all_passive_options(),
    defaultMoves: ["return", "none", "none", "none"],
    defaultPassive: "none"
  },
  {
    id: "croni",
    name: "Croni DR",
    role: "Return Dummy",
    stats: { level: 7, maxHp: 100, attack: 10, defense: 10, speed: 10 },
    possibleMoves: all_move_options(),
    possiblePassives: all_passive_options(),
    defaultMoves: ["none", "none", "none", "none"],
    defaultPassive: "none"
  },
  {
    id: "harpy",
    name: "Harpy TD",
    role: "Double-Edge Tester",
    stats: { level: 7, maxHp: 100, attack: 100, defense: 10, speed: 20 },
    possibleMoves: all_move_options(),
    possiblePassives: all_passive_options(),
    defaultMoves: ["double_edge", "none", "none", "none"],
    defaultPassive: "none"
  },
  {
    id: "hoof",
    name: "Hoof DD",
    role: "Double-Edge Dummy",
    stats: { level: 7, maxHp: 100, attack: 10, defense: 10, speed: 10 },
    possibleMoves: all_move_options(),
    possiblePassives: all_passive_options(),
    defaultMoves: ["none", "none", "none", "none"],
    defaultPassive: "none"
  },
  {
    id: "knight",
    name: "Knight TR",
    role: "Return Tester",
    stats: { level: 7, maxHp: 100, attack: 100, defense: 10, speed: 20 },
    possibleMoves: all_move_options(),
    possiblePassives: all_passive_options(),
    defaultMoves: ["return", "none", "none", "none"],
    defaultPassive: "none"
  },
  {
    id: "miren",
    name: "Miren DS",
    role: "Seismic Toss Dummy",
    stats: { level: 7, maxHp: 100, attack: 10, defense: 10, speed: 10 },
    possibleMoves: all_move_options(),
    possiblePassives: all_passive_options(),
    defaultMoves: ["none", "none", "none", "none"],
    defaultPassive: "none"
  },
  {
    id: "panda",
    name: "Panda TS",
    role: "Seismic Toss Tester",
    stats: { level: 7, maxHp: 100, attack: 100, defense: 10, speed: 20 },
    possibleMoves: all_move_options(),
    possiblePassives: all_passive_options(),
    defaultMoves: ["seismic_toss", "none", "none", "none"],
    defaultPassive: "none"
  },
  {
    id: "valkyria",
    name: "Valkyria DR",
    role: "Return Dummy",
    stats: { level: 7, maxHp: 100, attack: 10, defense: 10, speed: 10 },
    possibleMoves: all_move_options(),
    possiblePassives: all_passive_options(),
    defaultMoves: ["none", "none", "none", "none"],
    defaultPassive: "none"
  }
];

export const MONSTER_BY_ID = new Map<string, MonsterCatalogEntry>(
  MONSTER_ROSTER.map((entry) => [entry.id, entry])
);
