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
    stats: { level: 1, maxHp: 160, attack: 110, defense: 65, speed: 30 },
    possibleMoves: all_move_options(),
    possiblePassives: all_passive_options(),
    defaultMoves: ["return", "seismic_toss", "agility", "none"],
    defaultPassive: "leftovers"
  },
  {
    id: "croni",
    name: "Croni",
    role: "Ninjask",
    stats: { level: 1, maxHp: 61, attack: 90, defense: 45, speed: 160 },
    possibleMoves: all_move_options(),
    possiblePassives: all_passive_options(),
    defaultMoves: ["return", "seismic_toss", "agility", "none"],
    defaultPassive: "leftovers"
  },
  {
    id: "harpy",
    name: "Harpy",
    role: "Absol",
    stats: { level: 1, maxHp: 65, attack: 130, defense: 60, speed: 75 },
    possibleMoves: all_move_options(),
    possiblePassives: all_passive_options(),
    defaultMoves: ["return", "seismic_toss", "agility", "none"],
    defaultPassive: "leftovers"
  },
  {
    id: "hoof",
    name: "Hoof",
    role: "Chansey",
    stats: { level: 1, maxHp: 250, attack: 5, defense: 5, speed: 50 },
    possibleMoves: all_move_options(),
    possiblePassives: all_passive_options(),
    defaultMoves: ["return", "seismic_toss", "agility", "none"],
    defaultPassive: "leftovers"
  },
  {
    id: "knight",
    name: "Knight",
    role: "Metagross",
    stats: { level: 1, maxHp: 80, attack: 135, defense: 130, speed: 70 },
    possibleMoves: all_move_options(),
    possiblePassives: all_passive_options(),
    defaultMoves: ["return", "seismic_toss", "agility", "none"],
    defaultPassive: "leftovers"
  },
  {
    id: "miren",
    name: "Miren",
    role: "Celebi",
    stats: { level: 1, maxHp: 100, attack: 100, defense: 100, speed: 100 },
    possibleMoves: all_move_options(),
    possiblePassives: all_passive_options(),
    defaultMoves: ["return", "seismic_toss", "agility", "none"],
    defaultPassive: "leftovers"
  },
  {
    id: "panda",
    name: "Panda",
    role: "Cloyster",
    stats: { level: 1, maxHp: 50, attack: 95, defense: 180, speed: 70 },
    possibleMoves: all_move_options(),
    possiblePassives: all_passive_options(),
    defaultMoves: ["return", "seismic_toss", "agility", "none"],
    defaultPassive: "leftovers"
  },
  {
    id: "valkyria",
    name: "Valkyria",
    role: "Aerodactyl",
    stats: { level: 1, maxHp: 80, attack: 105, defense: 65, speed: 130 },
    possibleMoves: all_move_options(),
    possiblePassives: all_passive_options(),
    defaultMoves: ["return", "seismic_toss", "agility", "none"],
    defaultPassive: "leftovers"
  }
];

export const MONSTER_BY_ID = new Map<string, MonsterCatalogEntry>(
  MONSTER_ROSTER.map((entry) => [entry.id, entry])
);
