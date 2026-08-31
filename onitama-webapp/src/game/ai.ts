import type { Board, Card, Player, Pos } from "../types";
import {
  applyPieceMove,
  BOARD_SIZE,
  getAllLegalMoves,
  opponentGate,
  otherPlayer,
} from "./logic";
import type { LegalMove } from "./logic";

const AI_DEPTH = 3;

function findMaster(board: Board, player: Player): Pos | null {
  for (let y = 0; y < BOARD_SIZE; y++) {
    for (let x = 0; x < BOARD_SIZE; x++) {
      const piece = board[y][x];
      if (piece && piece.player === player && piece.type === "master") {
        return { x, y };
      }
    }
  }
  return null;
}

function manhattan(a: Pos, b: Pos): number {
  return Math.abs(a.x - b.x) + Math.abs(a.y - b.y);
}

interface Terminal {
  winner: Player;
}

function checkTerminal(board: Board): Terminal | null {
  for (const player of [1, 2] as Player[]) {
    const opponent = otherPlayer(player);
    const masterPos = findMaster(board, player);
    if (!masterPos) {
      return { winner: opponent };
    }
    const gate = opponentGate(player);
    if (masterPos.x === gate.x && masterPos.y === gate.y) {
      return { winner: player };
    }
  }
  return null;
}

function evaluate(board: Board, aiPlayer: Player): number {
  let score = 0;
  const opponent = otherPlayer(aiPlayer);

  for (let y = 0; y < BOARD_SIZE; y++) {
    for (let x = 0; x < BOARD_SIZE; x++) {
      const piece = board[y][x];
      if (!piece) continue;
      const sign = piece.player === aiPlayer ? 1 : -1;
      score += sign * (piece.type === "master" ? 1000 : 100);
      const centerDist = Math.abs(x - 2) + Math.abs(y - 2);
      score += sign * (4 - centerDist) * 2;
    }
  }

  const aiMaster = findMaster(board, aiPlayer);
  if (aiMaster) {
    score += (8 - manhattan(aiMaster, opponentGate(aiPlayer))) * 5;
  }
  const oppMaster = findMaster(board, opponent);
  if (oppMaster) {
    score -= (8 - manhattan(oppMaster, opponentGate(opponent))) * 5;
  }

  return score;
}

interface TurnHands {
  1: Card[];
  2: Card[];
}

function applyMoveForSearch(
  board: Board,
  hands: TurnHands,
  neutralCard: Card,
  turnPlayer: Player,
  move: LegalMove,
): { board: Board; hands: TurnHands; neutralCard: Card } {
  const { board: newBoard } = applyPieceMove(board, move.from, move.to);
  const usedCard = hands[turnPlayer].find((c) => c.id === move.cardId)!;
  const nextHand = hands[turnPlayer].filter((c) => c.id !== move.cardId).concat(neutralCard);
  const nextHands: TurnHands = { ...hands, [turnPlayer]: nextHand };
  return { board: newBoard, hands: nextHands, neutralCard: usedCard };
}

function applyPassForSearch(
  hands: TurnHands,
  neutralCard: Card,
  turnPlayer: Player,
  cardId: string,
): { hands: TurnHands; neutralCard: Card } {
  const usedCard = hands[turnPlayer].find((c) => c.id === cardId)!;
  const nextHand = hands[turnPlayer].filter((c) => c.id !== cardId).concat(neutralCard);
  const nextHands: TurnHands = { ...hands, [turnPlayer]: nextHand };
  return { hands: nextHands, neutralCard: usedCard };
}

function minimax(
  board: Board,
  hands: TurnHands,
  neutralCard: Card,
  turnPlayer: Player,
  aiPlayer: Player,
  depth: number,
  alpha: number,
  beta: number,
): number {
  const terminal = checkTerminal(board);
  if (terminal) {
    if (terminal.winner === aiPlayer) return 10000 + depth;
    return -10000 - depth;
  }
  if (depth === 0) {
    return evaluate(board, aiPlayer);
  }

  const maximizing = turnPlayer === aiPlayer;
  const legalMoves = getAllLegalMoves(board, turnPlayer, hands[turnPlayer]);

  if (legalMoves.length === 0) {
    let best = maximizing ? -Infinity : Infinity;
    for (const card of hands[turnPlayer]) {
      const { hands: nextHands, neutralCard: nextNeutral } = applyPassForSearch(
        hands,
        neutralCard,
        turnPlayer,
        card.id,
      );
      const value = minimax(
        board,
        nextHands,
        nextNeutral,
        otherPlayer(turnPlayer),
        aiPlayer,
        depth - 1,
        alpha,
        beta,
      );
      if (maximizing) {
        best = Math.max(best, value);
        alpha = Math.max(alpha, best);
      } else {
        best = Math.min(best, value);
        beta = Math.min(beta, best);
      }
      if (beta <= alpha) break;
    }
    return best;
  }

  let best = maximizing ? -Infinity : Infinity;
  for (const move of legalMoves) {
    const { board: nextBoard, hands: nextHands, neutralCard: nextNeutral } = applyMoveForSearch(
      board,
      hands,
      neutralCard,
      turnPlayer,
      move,
    );
    const value = minimax(
      nextBoard,
      nextHands,
      nextNeutral,
      otherPlayer(turnPlayer),
      aiPlayer,
      depth - 1,
      alpha,
      beta,
    );
    if (maximizing) {
      best = Math.max(best, value);
      alpha = Math.max(alpha, best);
    } else {
      best = Math.min(best, value);
      beta = Math.min(beta, best);
    }
    if (beta <= alpha) break;
  }
  return best;
}

export function pickBestMove(
  board: Board,
  hands: TurnHands,
  neutralCard: Card,
  aiPlayer: Player,
): LegalMove | null {
  const legalMoves = getAllLegalMoves(board, aiPlayer, hands[aiPlayer]);
  if (legalMoves.length === 0) return null;

  let bestMove: LegalMove | null = null;
  let bestValue = -Infinity;
  let alpha = -Infinity;
  const beta = Infinity;

  for (const move of legalMoves) {
    const { board: nextBoard, hands: nextHands, neutralCard: nextNeutral } = applyMoveForSearch(
      board,
      hands,
      neutralCard,
      aiPlayer,
      move,
    );
    const value = minimax(
      nextBoard,
      nextHands,
      nextNeutral,
      otherPlayer(aiPlayer),
      aiPlayer,
      AI_DEPTH - 1,
      alpha,
      beta,
    );
    if (value > bestValue) {
      bestValue = value;
      bestMove = move;
    }
    alpha = Math.max(alpha, bestValue);
  }

  return bestMove;
}
