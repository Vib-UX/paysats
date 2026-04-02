"use client";

import { useId } from "react";

type Props = {
  className?: string;
  /** Show wordmark next to mark */
  showWordmark?: boolean;
};

/**
 * Paysats wordmark + lightning mark. Inline SVG — no external assets.
 */
export function PaysatsLogo({ className = "", showWordmark = true }: Props) {
  const uid = useId().replace(/:/g, "");
  const gradId = `ps-grad-${uid}`;

  return (
    <span className={`inline-flex items-center gap-2 ${className}`}>
      <svg
        width="36"
        height="36"
        viewBox="0 0 40 40"
        fill="none"
        xmlns="http://www.w3.org/2000/svg"
        aria-hidden
        className="shrink-0"
      >
        <rect width="40" height="40" rx="12" fill={`url(#${gradId})`} />
        <path
          d="M22.5 10L14 22h5l-1.5 8 10.5-14h-5l-.5-6z"
          fill="#0a0a0a"
          stroke="#0a0a0a"
          strokeWidth="0.5"
          strokeLinejoin="round"
        />
        <defs>
          <linearGradient id={gradId} x1="8" y1="6" x2="34" y2="36" gradientUnits="userSpaceOnUse">
            <stop stopColor="#FFD700" />
            <stop offset="1" stopColor="#F7931A" />
          </linearGradient>
        </defs>
      </svg>
      {showWordmark ? (
        <span className="inline-flex items-baseline text-xl font-black tracking-tight sm:text-2xl">
          <span className="text-gradient-gold">Pay</span>
          <span className="text-white">sats</span>
        </span>
      ) : null}
    </span>
  );
}
