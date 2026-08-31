import { ONITAMA_CARDS } from "../data/cards";
import type { Board, Card, GameMode, GameState, Move, Piece, Player, Pos, Square } from "../types";

export const BOARD_SIZE = 5;

export const GATES: Record<Player, Pos> = {
  1: { x: 2, y: 4 },
  2: { x: 2, y: 0 },
};

export function opponentGate(player: Player): Pos {
  return player === 1 ? GATES[2] : GATES[1];
}

export function otherPlayer(player: Player): Player {
  return player === 1 ? 2 : 1;
}

function shuffled<T>(arr: T[]): T[] {
  const copy = [...arr];
  for (let i = copy.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [copy[i], copy[j]] = [copy[j], copy[i]];
  }
  return copy;
}

export function createInitialBoard(): Board {
  const board: Board = Array.from({ length: BOARD_SIZE }, () =>
    Array.from({ length: BOARD_SIZE }, (): Square => null),
  );

  const layout: PieceType[] = ["student", "student", "master", "student", "student"];
  layout.forEach((type, x) => {
    board[0][x] = { player: 2, type };
    board[4][x] = { player: 1, type };
  });

  return board;
}

type PieceType = Piece["type"];

export function dealCards(): { hands: Record<Player, Card[]>; neutralCard: Card } {
  const [c1, c2, c3, c4, c5] = shuffled(ONITAMA_CARDS).slice(0, 5);
  return {
    hands: { 1: [c1, c2], 2: [c3, c4] },
    neutralCard: c5,
  };
}

export function createInitialState(gameMode: GameMode): GameState {
  const { hands, neutralCard } = dealCards();
  const board = createInitialBoard();
  return {
    board,
    hands,
    neutralCard,
    currentTurn: 1,
    selectedCardId: null,
    selectedPos: null,
    validMoves: [],
    winner: null,
    winReason: null,
    gameMode,
    mustPass: !canPlayerMove(board, hands[1]),
  };
}

export function actualDelta(player: Player, move: Move): Move {
  return player === 1 ? move : { dx: -move.dx, dy: -move.dy };
}

function inBounds(pos: Pos): boolean {
  return pos.x >= 0 && pos.x < BOARD_SIZE && pos.y >= 0 && pos.y < BOARD_SIZE;
}

export function getValidMoves(board: Board, player: Player, pos: Pos, card: Card): Pos[] {
  const piece = board[pos.y]?.[pos.x];
  if (!piece || piece.player !== player) return [];

  const moves: Pos[] = [];
  for (const move of card.moves) {
    const delta = actualDelta(player, move);
    const to: Pos = { x: pos.x + delta.dx, y: pos.y + delta.dy };
    if (!inBounds(to)) continue;
    const destPiece = board[to.y][to.x];
    if (destPiece && destPiece.player === player) continue;
    moves.push(to);
  }
  return moves;
}

export function canPlayerMove(board: Board, hand: Card[]): boolean {
  for (let y = 0; y < BOARD_SIZE; y++) {
    for (let x = 0; x < BOARD_SIZE; x++) {
      const piece = board[y][x];
      if (!piece) continue;
      for (const card of hand) {
        if (getValidMoves(board, piece.player, { x, y }, card).length > 0) {
          return true;
        }
      }
    }
  }
  return false;
}

export interface MoveResult {
  board: Board;
  captured: Piece | null;
}

export function applyPieceMove(board: Board, from: Pos, to: Pos): MoveResult {
  const newBoard = board.map((row) => row.slice());
  const piece = newBoard[from.y][from.x];
  const captured = newBoard[to.y][to.x];
  newBoard[to.y][to.x] = piece;
  newBoard[from.y][from.x] = null;
  return { board: newBoard, captured };
}

export function checkWin(
  mover: Player,
  movedPiece: Piece,
  to: Pos,
  captured: Piece | null,
): { winner: Player; reason: "stone" | "stream" } | null {
  if (captured && captured.type === "master") {
    return { winner: mover, reason: "stone" };
  }
  const gate = opponentGate(mover);
  if (movedPiece.type === "master" && to.x === gate.x && to.y === gate.y) {
    return { winner: mover, reason: "stream" };
  }
  return null;
}

export function performMove(state: GameState, from: Pos, to: Pos, cardId: string): GameState {
  const player = state.currentTurn;
  const piece = state.board[from.y][from.x];
  if (!piece || piece.player !== player) return state;

  const usedCard = state.hands[player].find((c) => c.id === cardId);
  if (!usedCard) return state;

  const validMoves = getValidMoves(state.board, player, from, usedCard);
  if (!validMoves.some((m) => m.x === to.x && m.y === to.y)) return state;

  const { board, captured } = applyPieceMove(state.board, from, to);
  const win = checkWin(player, piece, to, captured);

  const nextHandForPlayer = state.hands[player]
    .filter((c) => c.id !== cardId)
    .concat(state.neutralCard);
  const nextHands: Record<Player, Card[]> = {
    ...state.hands,
    [player]: nextHandForPlayer,
  };

  const nextTurn = otherPlayer(player);

  return {
    ...state,
    board,
    hands: nextHands,
    neutralCard: usedCard,
    currentTurn: win ? state.currentTurn : nextTurn,
    selectedCardId: null,
    selectedPos: null,
    validMoves: [],
    winner: win ? win.winner : null,
    winReason: win ? win.reason : null,
    mustPass: win ? false : !canPlayerMove(board, nextHands[nextTurn]),
  };
}

export function performPass(state: GameState, cardId: string): GameState {
  const player = state.currentTurn;
  const usedCard = state.hands[player].find((c) => c.id === cardId);
  if (!usedCard) return state;

  const nextHandForPlayer = state.hands[player]
    .filter((c) => c.id !== cardId)
    .concat(state.neutralCard);
  const nextHands: Record<Player, Card[]> = {
    ...state.hands,
    [player]: nextHandForPlayer,
  };
  const nextTurn = otherPlayer(player);

  return {
    ...state,
    hands: nextHands,
    neutralCard: usedCard,
    currentTurn: nextTurn,
    selectedCardId: null,
    selectedPos: null,
    validMoves: [],
    mustPass: !canPlayerMove(state.board, nextHands[nextTurn]),
  };
}

export interface LegalMove {
  from: Pos;
  to: Pos;
  cardId: string;
}

export function getAllLegalMoves(board: Board, player: Player, hand: Card[]): LegalMove[] {
  const results: LegalMove[] = [];
  for (let y = 0; y < BOARD_SIZE; y++) {
    for (let x = 0; x < BOARD_SIZE; x++) {
      const piece = board[y][x];
      if (!piece || piece.player !== player) continue;
      for (const card of hand) {
        const moves = getValidMoves(board, player, { x, y }, card);
        for (const to of moves) {
          results.push({ from: { x, y }, to, cardId: card.id });
        }
      }
    }
  }
  return results;
}
