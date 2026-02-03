export type RoomId = string;

export type PlayerSlot = "player1" | "player2";

export type DummyState = {
  tick: number;
  players: Record<PlayerSlot, boolean>;
  note: string;
};

export type ClientMessage =
  | { $: "get_time" }
  | { $: "join"; room?: RoomId }
  | { $: "leave" }
  | { $: "input"; input: unknown; seq?: number }
  | { $: "ping"; time: number };

export type ServerMessage =
  | { $: "info_time"; time: number }
  | { $: "info_join"; room: RoomId; slot: PlayerSlot }
  | { $: "info_room"; room: RoomId; players: PlayerSlot[] }
  | { $: "info_input"; room: RoomId; slot: PlayerSlot; input: unknown; seq?: number }
  | { $: "info_state"; room: RoomId; state: DummyState }
  | { $: "info_pong"; time: number }
  | { $: "info_error"; message: string };
