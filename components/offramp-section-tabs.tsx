"use client";

export type OfframpSection = "pay" | "how" | "gifts" | "merchant";

const TABS: { id: OfframpSection; label: string }[] = [
  { id: "pay", label: "Settle" },
  { id: "how", label: "How it works" },
  { id: "gifts", label: "Gift cards" },
  { id: "merchant", label: "Merchants" }
];

/** Map URL hash (no `#`) to active section. Supports legacy `#merchant` from nav. */
export function sectionFromHash(hash: string): OfframpSection {
  const h = hash.replace(/^#/, "").toLowerCase();
  if (h === "merchant") return "merchant";
  if (h === "gift-cards" || h === "gifts") return "gifts";
  if (h === "how-it-works" || h === "how") return "how";
  return "pay";
}

export function hashForSection(s: OfframpSection): string {
  if (s === "pay") return "";
  if (s === "how") return "how-it-works";
  if (s === "gifts") return "gift-cards";
  return "merchant";
}

type Props = {
  value: OfframpSection;
  onChange: (next: OfframpSection) => void;
  className?: string;
};

export function OfframpSectionTabs({ value, onChange, className = "" }: Props) {
  return (
    <nav
      className={`rounded-2xl border border-border bg-card/60 p-1.5 ${className}`}
      aria-label="Page sections"
    >
      <div
        role="tablist"
        className="flex gap-1 overflow-x-auto [-ms-overflow-style:none] [scrollbar-width:none] [&::-webkit-scrollbar]:hidden"
      >
        {TABS.map((t) => {
          const selected = value === t.id;
          return (
            <button
              key={t.id}
              type="button"
              role="tab"
              aria-selected={selected}
              tabIndex={selected ? 0 : -1}
              onClick={() => onChange(t.id)}
              className={`tap-target min-h-[44px] shrink-0 rounded-xl px-3 py-2 text-sm font-bold transition ${
                selected ? "gold-gradient text-black shadow-sm" : "text-zinc-400 hover:bg-black/20 hover:text-zinc-100"
              }`}
            >
              {t.label}
            </button>
          );
        })}
      </div>
    </nav>
  );
}
