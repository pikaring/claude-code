export interface Move {
  dx: number;
  dy: number;
}

export interface Card {
  id: string;
  name: string;
  moves: Move[];
}

export type Player = 1 | 2;
export type PieceType = "master" | "student";

export interface Piece {
  player: Player;
  type: PieceType;
}

export type Square = Piece | null;
export type Board = Square[][]; // board[y][x], y: 0 (top, P2 side) .. 4 (bottom, P1 side)

export interface Pos {
  x: number;
  y: number;
}

export type WinReason = "stone" | "stream" | null;
export type GameMode = "pve" | "pvp";

export interface GameState {
  board: Board;
  hands: Record<Player, Card[]>; // each holds 2 cards
  neutralCard: Card;
  currentTurn: Player;
  selectedCardId: string | null;
  selectedPos: Pos | null;
  validMoves: Pos[];
  winner: Player | null;
  winReason: WinReason;
  gameMode: GameMode;
  mustPass: boolean;
}
