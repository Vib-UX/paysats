"use client";

import { useMemo, useState } from "react";
import { buildOfframpRouteHops, type OfframpOrderFields } from "@/lib/offramp-route";

type Props = {
  order: OfframpOrderFields | null | undefined;
  defaultOpen?: boolean;
  className?: string;
};

function StatusDot({ status }: { status: "pending" | "active" | "done" }) {
  if (status === "done") {
    return <span className="mt-0.5 grid h-6 w-6 shrink-0 place-items-center rounded-full bg-gold/20 text-xs font-bold text-gold">✓</span>;
  }
  if (status === "active") {
    return (
      <span className="mt-0.5 grid h-6 w-6 shrink-0 place-items-center rounded-full border-2 border-gold">
        <span className="h-2 w-2 animate-pulse rounded-full bg-gold" />
      </span>
    );
  }
  return <span className="mt-1.5 h-2 w-2 shrink-0 rounded-full bg-zinc-600" />;
}

export function OfframpRouteExpandable({ order, defaultOpen = false, className = "" }: Props) {
  const [open, setOpen] = useState(defaultOpen);
  const hops = useMemo(() => buildOfframpRouteHops(order), [order]);

  if (hops.length === 0) return null;

  return (
    <div className={`rounded-2xl border border-border bg-card ${className}`}>
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        className="flex w-full items-center justify-between gap-3 rounded-2xl px-4 py-3 text-left transition hover:bg-white/5"
        aria-expanded={open}
      >
        <div>
          <p className="text-xs font-bold uppercase tracking-wide text-zinc-400">Route</p>
          <p className="text-sm font-bold text-zinc-100">Each hop & references</p>
        </div>
        <span
          className={`grid h-9 w-9 shrink-0 place-items-center rounded-xl border border-border text-zinc-300 transition ${open ? "rotate-180" : ""}`}
          aria-hidden
        >
          <svg width="18" height="18" viewBox="0 0 24 24" fill="none">
            <path d="M6 9l6 6 6-6" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
          </svg>
        </span>
      </button>

      {open ? (
        <div className="border-t border-border px-4 pb-4 pt-1">
          <ol className="mt-2 space-y-4">
            {hops.map((hop, i) => (
              <li key={hop.id} className="flex gap-3">
                <div className="flex flex-col items-center">
                  <StatusDot status={hop.status} />
                  {i < hops.length - 1 ? <span className="mt-1 w-px flex-1 min-h-[12px] bg-zinc-700" /> : null}
                </div>
                <div className="min-w-0 flex-1 pb-1">
                  <p className="text-sm font-bold text-zinc-100">{hop.title}</p>
                  <p className="mt-1 text-xs leading-relaxed text-zinc-500">{hop.description}</p>
                  {hop.links.length > 0 ? (
                    <ul className="mt-2 flex flex-wrap gap-2">
                      {hop.links.map((link) => (
                        <li key={link.href}>
                          <a
                            href={link.href}
                            target="_blank"
                            rel="noopener noreferrer"
                            className="inline-flex rounded-lg border border-gold/35 bg-black/25 px-2.5 py-1 text-[11px] font-bold text-gold underline-offset-2 hover:border-gold/60 hover:underline"
                          >
                            {link.label}
                          </a>
                        </li>
                      ))}
                    </ul>
                  ) : null}
                </div>
              </li>
            ))}
          </ol>
        </div>
      ) : null}
    </div>
  );
}
