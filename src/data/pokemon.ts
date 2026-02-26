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
    name: "mon1",
    role: "Snorlax",
    type: type_for_index(0),
    stats: { level: 12, maxHp: 100, attack: 100, defense: 100, speed: 100 },
    possibleMoves: all_move_options(),
    possiblePassives: ["none"],
    defaultMoves: ["return", "seismic_toss", "none", "run"],
    defaultPassive: "none"
  },
  {
    id: "croni",
    name: "mon2",
    role: "Ninjask",
    type: type_for_index(1),
    stats: { level: 12, maxHp: 100, attack: 35, defense: 60, speed: 160 },
    possibleMoves: all_move_options(),
    possiblePassives: ["none"],
    defaultMoves: ["return", "seismic_toss", "none", "run"],
    defaultPassive: "none"
  },
  {
    id: "harpy",
    name: "mon3",
    role: "Absol",
    type: type_for_index(2),
    stats: { level: 12, maxHp: 180, attack: 521, defense: 230, speed: 292 },
    possibleMoves: all_move_options(),
    possiblePassives: ["none"],
    defaultMoves: ["return", "seismic_toss", "none", "run"],
    defaultPassive: "none"
  },
  {
    id: "hoof",
    name: "mon4",
    role: "Chansey",
    type: type_for_index(3),
    stats: { level: 12, maxHp: 950, attack: 0, defense: 0, speed: 188 },
    possibleMoves: all_move_options(),
    possiblePassives: ["none"],
    defaultMoves: ["return", "seismic_toss", "none", "run"],
    defaultPassive: "none"
  },
  {
    id: "knight",
    name: "Mon1",
    role: "Metagross",
    type: "def",
    stats: { level: 12, maxHp: 242, attack: 80, defense: 160, speed: 85 },
    possibleMoves: all_move_options(),
    possiblePassives: ["none"],
    defaultMoves: ["return", "rejuvenation", "none", "run"],
    defaultPassive: "none"
  },
  {
    id: "night_sekyps",
    name: "mon5",
    role: "Metagross Sekyps",
    type: "atk",
    stats: { level: 12, maxHp: 242, attack: 115, defense: 75, speed: 75 },
    possibleMoves: ["sekyps", "kick", "run", "none"],
    possiblePassives: ["none"],
    defaultMoves: ["sekyps", "kick", "none", "run"],
    defaultPassive: "none"
  },
  {
    id: "miren",
    name: "mon6",
    role: "Celebi",
    type: type_for_index(5),
    stats: { level: 12, maxHp: 325, attack: 396, defense: 396, speed: 396 },
    possibleMoves: all_move_options(),
    possiblePassives: ["none"],
    defaultMoves: ["return", "seismic_toss", "none", "run"],
    defaultPassive: "none"
  },
  {
    id: "panda",
    name: "mon7",
    role: "Cloyster",
    type: type_for_index(6),
    stats: { level: 12, maxHp: 117, attack: 375, defense: 730, speed: 271 },
    possibleMoves: all_move_options(),
    possiblePassives: ["none"],
    defaultMoves: ["return", "seismic_toss", "none", "run"],
    defaultPassive: "none"
  },
  {
    id: "valkyria",
    name: "mon8",
    role: "Aerodactyl",
    type: type_for_index(7),
    stats: { level: 12, maxHp: 242, attack: 100, defense: 100, speed: 100 },
    possibleMoves: all_move_options(),
    possiblePassives: ["none"],
    defaultMoves: ["return", "seismic_toss", "none", "run"],
    defaultPassive: "none"
  },
  {
    id: "vealkiria",
    name: "Vealkiria",
    role: "Valkyria ATK Template",
    type: "atk",
    stats: { level: 12, maxHp: 242, attack: 115, defense: 75, speed: 120 },
    possibleMoves: ["punch", "heal", "run", "none"],
    possiblePassives: ["none"],
    defaultMoves: ["punch", "heal", "none", "run"],
    defaultPassive: "none"
  },
  {
    id: "babydragonbuf",
    name: "Baby Dragon Buff",
    role: "Baby Dragon BUF Template",
    type: "buf",
    stats: { level: 12, maxHp: 100, attack: 100, defense: 100, speed: 100 },
    possibleMoves: ["power", "ki_blast", "run", "none"],
    possiblePassives: ["none"],
    defaultMoves: ["power", "ki_blast", "none", "run"],
    defaultPassive: "none"
  },
  {
    id: "armoth",
    name: "Armoth",
    role: "Cloyster Template",
    type: "def",
    stats: { level: 12, maxHp: 117, attack: 50, defense: 160, speed: 70 },
    possibleMoves: ["bait", "seismic_toss", "run", "none"],
    possiblePassives: ["none"],
    defaultMoves: ["bait", "seismic_toss", "none", "run"],
    defaultPassive: "none"
  },
  {
    id: "kairus",
    name: "Kairus",
    role: "Absol Template",
    type: "atk",
    stats: { level: 12, maxHp: 180, attack: 115, defense: 75, speed: 130 },
    possibleMoves: ["kick", "throw", "run", "none"],
    possiblePassives: ["none"],
    defaultMoves: ["kick", "throw", "none", "run"],
    defaultPassive: "none"
  },
  {
    id: "farien",
    name: "Farien",
    role: "Celebi Template",
    type: "buf",
    stats: { level: 12, maxHp: 325, attack: 100, defense: 100, speed: 100 },
    possibleMoves: ["switch_sovietico", "team_cure", "run", "none"],
    possiblePassives: ["none"],
    defaultMoves: ["switch_sovietico", "team_cure", "none", "run"],
    defaultPassive: "none"
  }
];

export const MONSTER_BY_ID = new Map<string, MonsterCatalogEntry>(
  MONSTER_ROSTER.map((entry) => [entry.id, entry])
);
