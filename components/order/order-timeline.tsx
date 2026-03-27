import { ORDER_STATES, OrderState, STATE_LABELS } from "@/lib/state";

export function OrderTimeline({ state }: { state: OrderState }) {
  const currentIndex = ORDER_STATES.indexOf(state);

  return (
    <div className="rounded-2xl border border-border bg-card p-4">
      <h3 className="mb-3 text-sm font-bold uppercase tracking-wide text-zinc-300">Order State</h3>
      <ul className="space-y-2 text-sm">
        {ORDER_STATES.map((step, index) => {
          const done = index <= currentIndex;
          return (
            <li key={step} className={`flex items-center justify-between ${done ? "text-gold" : "text-zinc-500"}`}>
              <span>{STATE_LABELS[step]}</span>
              <span>{done ? "✓" : "·"}</span>
            </li>
          );
        })}
      </ul>
    </div>
  );
}
