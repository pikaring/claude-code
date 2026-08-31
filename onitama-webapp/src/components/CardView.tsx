import type { Card, Player } from "../types";

interface CardViewProps {
  card: Card;
  owner: Player | "neutral";
  label?: string;
  selected?: boolean;
  disabled?: boolean;
  onClick?: () => void;
}

function displayMoves(card: Card, owner: Player | "neutral") {
  if (owner === 2) {
    return card.moves.map((m) => ({ dx: -m.dx, dy: -m.dy }));
  }
  return card.moves;
}

export function CardView({ card, owner, label, selected, disabled, onClick }: CardViewProps) {
  const moves = displayMoves(card, owner);
  const cells = new Set(moves.map((m) => `${m.dx + 2},${m.dy + 2}`));

  const ownerColor =
    owner === 1
      ? "border-sky-400"
      : owner === 2
        ? "border-rose-400"
        : "border-zinc-400 dark:border-zinc-500";

  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled || !onClick}
      className={`flex w-24 flex-col items-center gap-1 rounded-lg border-2 bg-white p-2 shadow-sm transition dark:bg-zinc-800 ${ownerColor} ${
        selected ? "ring-4 ring-amber-400 -translate-y-1" : ""
      } ${onClick && !disabled ? "cursor-pointer hover:-translate-y-0.5 hover:shadow-md" : "cursor-default"}`}
    >
      <span className="text-xs font-bold text-zinc-700 dark:text-zinc-100">{card.name}</span>
      <div className="grid grid-cols-5 gap-[2px]">
        {Array.from({ length: 25 }, (_, i) => {
          const x = i % 5;
          const y = Math.floor(i / 5);
          const isCenter = x === 2 && y === 2;
          const isMove = cells.has(`${x},${y}`);
          return (
            <div
              key={i}
              className={`h-2.5 w-2.5 rounded-[2px] ${
                isCenter
                  ? "bg-zinc-800 dark:bg-zinc-100"
                  : isMove
                    ? "bg-amber-400"
                    : "bg-zinc-200 dark:bg-zinc-600"
              }`}
            />
          );
        })}
      </div>
      {label && <span className="text-[10px] text-zinc-500 dark:text-zinc-400">{label}</span>}
    </button>
  );
}
