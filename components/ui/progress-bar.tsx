import { ORDER_STATES, OrderState } from "@/lib/state";

export function ProgressBar({ state }: { state: OrderState }) {
  const index = ORDER_STATES.indexOf(state);
  const percentage = Math.max(0, Math.min(100, (index / (ORDER_STATES.length - 1)) * 100));

  return (
    <div className="mb-4 w-full">
      <div className="mb-2 flex items-center justify-between text-xs text-zinc-400">
        <span>Progress</span>
        <span>{Math.round(percentage)}%</span>
      </div>
      <div className="h-2 rounded-full bg-zinc-900">
        <div className="gold-gradient h-2 rounded-full" style={{ width: `${percentage}%` }} />
      </div>
    </div>
  );
}
