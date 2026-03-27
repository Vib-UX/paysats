import { ButtonHTMLAttributes } from "react";

type Props = ButtonHTMLAttributes<HTMLButtonElement> & {
  loading?: boolean;
};

export function Button({ className = "", loading, children, disabled, ...props }: Props) {
  return (
    <button
      {...props}
      disabled={disabled || loading}
      className={`tap-target w-full rounded-xl px-4 py-3 font-bold text-black transition active:scale-[0.99] disabled:opacity-40 ${className}`}
    >
      {loading ? "Loading..." : children}
    </button>
  );
}
