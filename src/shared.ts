export type RoomId = string;

export type PlayerSlot = "player1" | "player2";

export type DummyState = {
  turn: number;
  players: Record<PlayerSlot, boolean>;
  note: string;
};

export type ClientMessage =
  | { $: "get_time" }
  | { $: "join"; room?: RoomId; token?: string }
  | { $: "leave" }
  | { $: "submit_intent"; intent: unknown; turn?: number }
  | { $: "ping"; time: number };

export type ServerMessage =
  | { $: "info_time"; time: number }
  | { $: "info_join"; room: RoomId; slot: PlayerSlot; token: string; reconnect?: boolean }
  | { $: "info_room"; room: RoomId; players: PlayerSlot[] }
  | { $: "info_turn"; room: RoomId; turn: number; deadline_at: number; intents: Record<PlayerSlot, boolean> }
  | { $: "info_intent_locked"; room: RoomId; slot: PlayerSlot; turn: number }
  | { $: "info_state"; room: RoomId; state: DummyState; log: string[] }
  | { $: "info_forfeit"; room: RoomId; turn: number; losers: PlayerSlot[]; winner?: PlayerSlot }
  | { $: "info_pong"; time: number }
  | { $: "info_error"; message: string };
