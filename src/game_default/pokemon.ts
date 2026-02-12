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
    name: "Baby Dragon",
    role: "Snorlax",
    stats: { level: 100, maxHp: 575, attack: 438, defense: 250, speed: 105 },
    possibleMoves: all_move_options(),
    possiblePassives: all_passive_options(),
    defaultMoves: ["return", "seismic_toss", "agility", "none"],
    defaultPassive: "leftovers"
  },
  {
    id: "croni",
    name: "Croni",
    role: "Ninjask",
    stats: { level: 100, maxHp: 163, attack: 355, defense: 167, speed: 646 },
    possibleMoves: all_move_options(),
    possiblePassives: all_passive_options(),
    defaultMoves: ["return", "seismic_toss", "agility", "none"],
    defaultPassive: "leftovers"
  },
  {
    id: "harpy",
    name: "Harpy",
    role: "Absol",
    stats: { level: 100, maxHp: 180, attack: 521, defense: 230, speed: 292 },
    possibleMoves: all_move_options(),
    possiblePassives: all_passive_options(),
    defaultMoves: ["return", "seismic_toss", "agility", "none"],
    defaultPassive: "leftovers"
  },
  {
    id: "hoof",
    name: "Hoof",
    role: "Chansey",
    stats: { level: 100, maxHp: 950, attack: 0, defense: 0, speed: 188 },
    possibleMoves: all_move_options(),
    possiblePassives: all_passive_options(),
    defaultMoves: ["return", "seismic_toss", "agility", "none"],
    defaultPassive: "leftovers"
  },
  {
    id: "knight",
    name: "Knight",
    role: "Metagross",
    stats: { level: 100, maxHp: 242, attack: 542, defense: 521, speed: 271 },
    possibleMoves: all_move_options(),
    possiblePassives: all_passive_options(),
    defaultMoves: ["return", "seismic_toss", "agility", "none"],
    defaultPassive: "leftovers"
  },
  {
    id: "miren",
    name: "Miren",
    role: "Celebi",
    stats: { level: 100, maxHp: 325, attack: 396, defense: 396, speed: 396 },
    possibleMoves: all_move_options(),
    possiblePassives: all_passive_options(),
    defaultMoves: ["return", "seismic_toss", "agility", "none"],
    defaultPassive: "leftovers"
  },
  {
    id: "panda",
    name: "Panda",
    role: "Cloyster",
    stats: { level: 100, maxHp: 117, attack: 375, defense: 730, speed: 271 },
    possibleMoves: all_move_options(),
    possiblePassives: all_passive_options(),
    defaultMoves: ["return", "seismic_toss", "agility", "none"],
    defaultPassive: "leftovers"
  },
  {
    id: "valkyria",
    name: "Valkyria",
    role: "Aerodactyl",
    stats: { level: 100, maxHp: 242, attack: 417, defense: 250, speed: 521 },
    possibleMoves: all_move_options(),
    possiblePassives: all_passive_options(),
    defaultMoves: ["return", "seismic_toss", "agility", "none"],
    defaultPassive: "leftovers"
  }
];

export const MONSTER_BY_ID = new Map<string, MonsterCatalogEntry>(
  MONSTER_ROSTER.map((entry) => [entry.id, entry])
);
