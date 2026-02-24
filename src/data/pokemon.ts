import { MOVE_OPTIONS } from "./moves.ts";
import type { MonsterCatalogEntry } from "./types.ts";
import type { MonsterType } from "../shared.ts";

function all_move_options(): string[] {
  return MOVE_OPTIONS.slice();
}

function type_for_index(index: number): MonsterType {
  const order: MonsterType[] = ["buf", "def", "atk"];
  return order[index % order.length];
}

export const MONSTER_ROSTER: readonly MonsterCatalogEntry[] = [
  {
    id: "babydragon",
    name: "Baby Dragon",
    role: "Snorlax",
    type: type_for_index(0),
    stats: { level: 12, maxHp: 575, attack: 438, defense: 250, speed: 105 },
    possibleMoves: all_move_options(),
    possiblePassives: ["none"],
    defaultMoves: ["return", "seismic_toss", "agility"],
    defaultPassive: "none"
  },
  {
    id: "croni",
    name: "Croni",
    role: "Ninjask",
    type: type_for_index(1),
    stats: { level: 12, maxHp: 163, attack: 355, defense: 167, speed: 646 },
    possibleMoves: all_move_options(),
    possiblePassives: ["none"],
    defaultMoves: ["return", "seismic_toss", "agility"],
    defaultPassive: "none"
  },
  {
    id: "harpy",
    name: "Harpy",
    role: "Absol",
    type: type_for_index(2),
    stats: { level: 12, maxHp: 180, attack: 521, defense: 230, speed: 292 },
    possibleMoves: all_move_options(),
    possiblePassives: ["none"],
    defaultMoves: ["return", "seismic_toss", "agility"],
    defaultPassive: "none"
  },
  {
    id: "hoof",
    name: "Hoof",
    role: "Chansey",
    type: type_for_index(3),
    stats: { level: 12, maxHp: 950, attack: 0, defense: 0, speed: 188 },
    possibleMoves: all_move_options(),
    possiblePassives: ["none"],
    defaultMoves: ["return", "seismic_toss", "agility"],
    defaultPassive: "none"
  },
  {
    id: "knight",
    name: "Knight",
    role: "Metagross",
    type: type_for_index(4),
    stats: { level: 12, maxHp: 242, attack: 542, defense: 521, speed: 271 },
    possibleMoves: all_move_options(),
    possiblePassives: ["none"],
    defaultMoves: ["return", "seismic_toss", "agility"],
    defaultPassive: "none"
  },
  {
    id: "miren",
    name: "Miren",
    role: "Celebi",
    type: type_for_index(5),
    stats: { level: 12, maxHp: 325, attack: 396, defense: 396, speed: 396 },
    possibleMoves: all_move_options(),
    possiblePassives: ["none"],
    defaultMoves: ["return", "seismic_toss", "agility"],
    defaultPassive: "none"
  },
  {
    id: "panda",
    name: "Panda",
    role: "Cloyster",
    type: type_for_index(6),
    stats: { level: 12, maxHp: 117, attack: 375, defense: 730, speed: 271 },
    possibleMoves: all_move_options(),
    possiblePassives: ["none"],
    defaultMoves: ["return", "seismic_toss", "agility"],
    defaultPassive: "none"
  },
  {
    id: "valkyria",
    name: "Valkyria",
    role: "Aerodactyl",
    type: type_for_index(7),
    stats: { level: 12, maxHp: 242, attack: 417, defense: 250, speed: 521 },
    possibleMoves: all_move_options(),
    possiblePassives: ["none"],
    defaultMoves: ["return", "seismic_toss", "agility"],
    defaultPassive: "none"
  },
  {
    id: "armoth",
    name: "Armoth",
    role: "Cloyster Template",
    type: "def",
    stats: { level: 12, maxHp: 117, attack: 375, defense: 730, speed: 271 },
    possibleMoves: ["spikes", "recover", "run", "none"],
    possiblePassives: ["none"],
    defaultMoves: ["spikes", "recover", "none"],
    defaultPassive: "none"
  },
  {
    id: "kairus",
    name: "Kairus",
    role: "Absol Template",
    type: "atk",
    stats: { level: 12, maxHp: 180, attack: 521, defense: 230, speed: 430 },
    possibleMoves: ["mega_punch", "bounce_kick", "run", "none"],
    possiblePassives: ["none"],
    defaultMoves: ["mega_punch", "bounce_kick", "none"],
    defaultPassive: "none"
  },
  {
    id: "farien",
    name: "Farien",
    role: "Celebi Template",
    type: "buf",
    stats: { level: 12, maxHp: 325, attack: 396, defense: 396, speed: 396 },
    possibleMoves: ["meditate", "ki_blast", "run", "none"],
    possiblePassives: ["none"],
    defaultMoves: ["meditate", "ki_blast", "none"],
    defaultPassive: "none"
  }
];

export const MONSTER_BY_ID = new Map<string, MonsterCatalogEntry>(
  MONSTER_ROSTER.map((entry) => [entry.id, entry])
);
