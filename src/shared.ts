export type RoomId = string;

export type PlayerSlot = "player1" | "player2";

export type MoveId = "basic_attack" | "none" | "protect" | string;
export type PassiveId = "none" | "leftovers" | "choice_band" | "regen_5pct" | string;

export type EVSpread = {
  hp: number;
  atk: number;
  def: number;
  spe: number;
};

export type Stats = {
  level: number;
  maxHp: number;
  attack: number;
  defense: number;
  speed: number;
};

export type MonsterConfig = {
  id: string;
  moves: MoveId[];
  passive: PassiveId;
  stats: Stats;
  ev: EVSpread;
};

export type TeamSelection = {
  monsters: MonsterConfig[];
  activeIndex: number;
};

export type MonsterState = {
  id: string;
  name: string;
  hp: number;
  maxHp: number;
  level: number;
  attack: number;
  defense: number;
  speed: number;
  possibleMoves: MoveId[];
  possiblePassives: PassiveId[];
  chosenMoves: MoveId[];
  chosenPassive: PassiveId;
  protectActiveThisTurn: boolean;
  endureActiveThisTurn: boolean;
  choiceBandLockedMoveIndex: number | null;
  protectCooldownTurns: number;
  endureCooldownTurns: number;
};

export type PlayerState = {
  slot: PlayerSlot;
  name: string;
  team: MonsterState[];
  activeIndex: number;
};

export type GameState = {
  turn: number;
  status: "setup" | "running" | "ended";
  winner?: PlayerSlot;
  players: Record<PlayerSlot, PlayerState>;
  pendingSwitch: Record<PlayerSlot, boolean>;
  pendingWish: Record<PlayerSlot, number | null>;
  tauntUntilTurn: Record<PlayerSlot, number>;
  leechSeedActiveByTarget: Record<PlayerSlot, boolean>;
  leechSeedSourceByTarget: Record<PlayerSlot, PlayerSlot | null>;
};

export type PlayerIntent =
  | { action: "switch"; targetIndex: number }
  | { action: "use_move"; moveIndex: number };

export type EventLog = {
  type: string;
  turn: number;
  phase?: string;
  summary: string;
  data?: Record<string, unknown>;
};

export type JoinPost = { $: "join"; name: string; player_id?: string; token?: string };
export type AssignPost = { $: "assign"; slot: PlayerSlot; token: string; name: string };
export type SpectatorPost = { $: "spectator"; name: string };
export type ChatPost = { $: "chat"; message: string; from: string; player_id?: string };
export type ParticipantsPost = {
  $: "participants";
  players: Record<PlayerSlot, string | null>;
  spectators: string[];
};
export type ReadyPost = { $: "ready"; ready: boolean; team?: TeamSelection; player_id?: string };
export type ReadyStatePost = {
  $: "ready_state";
  ready: Record<PlayerSlot, boolean>;
  names: Record<PlayerSlot, string | null>;
  order?: PlayerSlot[];
};
export type IntentPost = {
  $: "intent";
  turn: number;
  intent: PlayerIntent;
  forcedSwitchTargetIndex?: number;
  player_id?: string;
};
export type ForcedSwitchPost = { $: "forced_switch"; targetIndex: number; player_id?: string };
export type IntentLockedPost = { $: "intent_locked"; slot: PlayerSlot; turn: number };
export type TurnStartPost = { $: "turn_start"; turn: number; deadline_at: number; intents: Record<PlayerSlot, boolean> };
export type StatePost = { $: "state"; turn: number; state: GameState; log: EventLog[] };
export type SurrenderRequestPost = { $: "surrender"; player_id?: string };
export type SurrenderPost = { $: "surrender"; turn: number; loser: PlayerSlot; winner: PlayerSlot };
export type ErrorPost = { $: "error"; message: string; code?: string };

export type RoomPost =
  | JoinPost
  | AssignPost
  | SpectatorPost
  | ChatPost
  | ParticipantsPost
  | ReadyPost
  | ReadyStatePost
  | IntentPost
  | ForcedSwitchPost
  | IntentLockedPost
  | TurnStartPost
  | StatePost
  | SurrenderRequestPost
  | SurrenderPost
  | ErrorPost;

export type ClientMessage =
  | { $: "get_time" }
  | { $: "post"; room: RoomId; time: number; name?: string; data: RoomPost }
  | { $: "load"; room: RoomId; from?: number }
  | { $: "watch"; room: RoomId }
  | { $: "unwatch"; room: RoomId };

export type ServerMessage =
  | { $: "info_time"; time: number }
  | {
      $: "info_post";
      room: RoomId;
      index: number;
      server_time: number;
      client_time: number;
      name?: string;
      data: RoomPost;
    };
