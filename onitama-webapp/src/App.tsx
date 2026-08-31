import { useEffect, useState } from "react";
import { BoardView } from "./components/Board";
import { CardView } from "./components/CardView";
import { WinModal } from "./components/WinModal";
import { pickBestMove } from "./game/ai";
import { createInitialState, getValidMoves, performMove, performPass } from "./game/logic";
import type { Card, GameMode, GameState, Pos } from "./types";

function findCard(cards: Card[], id: string | null): Card | undefined {
  if (!id) return undefined;
  return cards.find((c) => c.id === id);
}

export default function App() {
  const [gameMode, setGameMode] = useState<GameMode>("pve");
  const [state, setState] = useState<GameState>(() => createInitialState("pve"));

  const isCpuTurn = state.gameMode === "pve" && state.currentTurn === 2;

  function restart(mode: GameMode) {
    setGameMode(mode);
    setState(createInitialState(mode));
  }

  useEffect(() => {
    if (state.winner || state.gameMode !== "pve" || state.currentTurn !== 2) return;

    const timer = setTimeout(() => {
      setState((prev) => {
        if (prev.winner || prev.currentTurn !== 2) return prev;
        if (prev.mustPass) {
          return performPass(prev, prev.hands[2][0].id);
        }
        const best = pickBestMove(prev.board, prev.hands, prev.neutralCard, 2);
        if (!best) return prev;
        return performMove(prev, best.from, best.to, best.cardId);
      });
    }, 700);

    return () => clearTimeout(timer);
  }, [state.currentTurn, state.winner, state.gameMode, state.mustPass]);

  function handleCardClick(player: 1 | 2, card: Card) {
    if (state.winner || isCpuTurn || player !== state.currentTurn) return;

    if (state.mustPass) {
      setState(performPass(state, card.id));
      return;
    }

    setState((prev) => ({
      ...prev,
      selectedCardId: prev.selectedCardId === card.id ? null : card.id,
      selectedPos: null,
      validMoves: [],
    }));
  }

  function handleSquareClick(pos: Pos) {
    if (state.winner || isCpuTurn || state.mustPass) return;

    if (state.selectedCardId && state.selectedPos) {
      const isValidTarget = state.validMoves.some((m) => m.x === pos.x && m.y === pos.y);
      if (isValidTarget) {
        setState(performMove(state, state.selectedPos, pos, state.selectedCardId));
        return;
      }
    }

    const square = state.board[pos.y][pos.x];
    if (square && square.player === state.currentTurn && state.selectedCardId) {
      const card = findCard(state.hands[state.currentTurn], state.selectedCardId);
      if (!card) return;
      const moves = getValidMoves(state.board, state.currentTurn, pos, card);
      setState((prev) => ({ ...prev, selectedPos: pos, validMoves: moves }));
    } else {
      setState((prev) => ({ ...prev, selectedPos: null, validMoves: [] }));
    }
  }

  const turnLabel = state.winner
    ? "対局終了"
    : isCpuTurn
      ? "CPU思考中..."
      : state.mustPass
        ? `Player ${state.currentTurn} の手番(動かせる駒がありません。カードを選んでパス)`
        : `Player ${state.currentTurn} の手番`;

  return (
    <div className="mx-auto flex min-h-screen max-w-3xl flex-col items-center gap-4 bg-zinc-50 p-4 dark:bg-zinc-900">
      <header className="flex w-full flex-col items-center gap-2">
        <h1 className="text-2xl font-extrabold text-zinc-800 dark:text-zinc-100">
          オンタマ <span className="text-base font-normal text-zinc-400">Onitama</span>
        </h1>
        <div className="flex gap-2">
          <button
            type="button"
            onClick={() => restart("pve")}
            className={`rounded-full px-3 py-1 text-sm font-medium ${
              gameMode === "pve"
                ? "bg-amber-500 text-white"
                : "bg-zinc-200 text-zinc-600 dark:bg-zinc-700 dark:text-zinc-300"
            }`}
          >
            1人 vs CPU
          </button>
          <button
            type="button"
            onClick={() => restart("pvp")}
            className={`rounded-full px-3 py-1 text-sm font-medium ${
              gameMode === "pvp"
                ? "bg-amber-500 text-white"
                : "bg-zinc-200 text-zinc-600 dark:bg-zinc-700 dark:text-zinc-300"
            }`}
          >
            2人ローカル対戦
          </button>
          <button
            type="button"
            onClick={() => restart(gameMode)}
            className="rounded-full bg-zinc-200 px-3 py-1 text-sm font-medium text-zinc-600 dark:bg-zinc-700 dark:text-zinc-300"
          >
            リセット
          </button>
        </div>
      </header>

      <section className="flex w-full items-start justify-center gap-4">
        <div className="flex gap-2">
          {state.hands[2].map((card) => (
            <CardView
              key={card.id}
              card={card}
              owner={2}
              selected={state.currentTurn === 2 && state.selectedCardId === card.id}
              disabled={state.currentTurn !== 2 || isCpuTurn || !!state.winner}
              onClick={() => handleCardClick(2, card)}
            />
          ))}
        </div>
        <CardView card={state.neutralCard} owner="neutral" label="待機" />
      </section>

      <p className="text-sm font-semibold text-zinc-600 dark:text-zinc-300">{turnLabel}</p>

      <BoardView
        board={state.board}
        validMoves={state.validMoves}
        selectedPos={state.selectedPos}
        onSquareClick={handleSquareClick}
      />

      <section className="flex gap-2">
        {state.hands[1].map((card) => (
          <CardView
            key={card.id}
            card={card}
            owner={1}
            selected={state.currentTurn === 1 && state.selectedCardId === card.id}
            disabled={state.currentTurn !== 1 || !!state.winner}
            onClick={() => handleCardClick(1, card)}
          />
        ))}
      </section>

      {state.winner && (
        <WinModal
          winner={state.winner}
          reason={state.winReason}
          onRestart={() => restart(gameMode)}
        />
      )}
    </div>
  );
}
