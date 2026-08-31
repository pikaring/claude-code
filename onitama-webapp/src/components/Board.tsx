import type { Board as BoardType, Pos } from "../types";
import { GATES } from "../game/logic";

interface BoardProps {
  board: BoardType;
  validMoves: Pos[];
  selectedPos: Pos | null;
  onSquareClick: (pos: Pos) => void;
}

function isSamePos(a: Pos, b: Pos) {
  return a.x === b.x && a.y === b.y;
}

export function BoardView({ board, validMoves, selectedPos, onSquareClick }: BoardProps) {
  return (
    <div className="grid grid-cols-5 gap-1 rounded-xl bg-zinc-300 p-2 shadow-inner dark:bg-zinc-700">
      {board.map((row, y) =>
        row.map((square, x) => {
          const pos = { x, y };
          const isGate1 = GATES[1].x === x && GATES[1].y === y;
          const isGate2 = GATES[2].x === x && GATES[2].y === y;
          const isSelected = selectedPos && isSamePos(selectedPos, pos);
          const isValidMove = validMoves.some((m) => isSamePos(m, pos));
          const dark = (x + y) % 2 === 1;

          return (
            <button
              key={`${x}-${y}`}
              type="button"
              onClick={() => onSquareClick(pos)}
              className={`relative flex h-14 w-14 items-center justify-center rounded-md text-lg font-bold transition sm:h-16 sm:w-16 ${
                dark ? "bg-amber-100 dark:bg-zinc-600" : "bg-amber-50 dark:bg-zinc-500"
              } ${isSelected ? "ring-4 ring-amber-500" : ""}`}
            >
              {(isGate1 || isGate2) && !square && (
                <span
                  className={`absolute text-2xl opacity-30 ${
                    isGate1 ? "text-sky-600" : "text-rose-600"
                  }`}
                >
                  ⛩
                </span>
              )}
              {isValidMove && (
                <span className="absolute h-4 w-4 rounded-full bg-emerald-500/70" />
              )}
              {square && (
                <span
                  className={`z-10 flex h-10 w-10 items-center justify-center rounded-full border-2 shadow sm:h-11 sm:w-11 ${
                    square.player === 1
                      ? "border-sky-600 bg-sky-400 text-sky-900"
                      : "border-rose-600 bg-rose-400 text-rose-900"
                  }`}
                >
                  {square.type === "master" ? "王" : "兵"}
                </span>
              )}
            </button>
          );
        }),
      )}
    </div>
  );
}
