import type { Player, WinReason } from "../types";

interface WinModalProps {
  winner: Player;
  reason: WinReason;
  onRestart: () => void;
}

export function WinModal({ winner, reason, onRestart }: WinModalProps) {
  const reasonText =
    reason === "stone" ? "マスター撃破！(石の道)" : "拠点制圧！(小川の道)";

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4">
      <div className="w-full max-w-sm rounded-2xl bg-white p-6 text-center shadow-2xl dark:bg-zinc-800">
        <p className="text-sm font-medium text-zinc-500 dark:text-zinc-400">対局終了</p>
        <h2
          className={`mt-1 text-3xl font-extrabold ${
            winner === 1 ? "text-sky-600" : "text-rose-600"
          }`}
        >
          Player {winner} の勝利！
        </h2>
        <p className="mt-3 text-lg text-zinc-700 dark:text-zinc-200">{reasonText}</p>
        <button
          type="button"
          onClick={onRestart}
          className="mt-6 w-full rounded-lg bg-amber-500 py-2.5 font-bold text-white shadow hover:bg-amber-600"
        >
          もう一度対局する
        </button>
      </div>
    </div>
  );
}
