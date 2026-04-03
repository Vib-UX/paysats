import Image from "next/image";

type Props = {
  className?: string;
  /** Square display size in px. */
  size?: number;
  /** Empty when “IDRX” is written beside the mark (decorative). */
  alt?: string;
};

/** IDRX icon (blue mark) — `public/idrx-icon.png`. Pair with visible “IDRX” text in copy. */
export function IdrxMark({ className = "", size = 22, alt = "" }: Props) {
  return (
    <Image
      src="/idrx-icon.png"
      alt={alt}
      width={size}
      height={size}
      className={`inline-block shrink-0 object-contain ${className}`}
    />
  );
}
