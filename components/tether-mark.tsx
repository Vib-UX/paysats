import Image from "next/image";

type Props = {
  className?: string;
  /** Display width/height in px (square asset). */
  size?: number;
  /** Empty when “Tether” appears in adjacent copy (avoids duplicate screen-reader output). */
  alt?: string;
};

/** Tether mark — `public/tether-logo.png` */
export function TetherMark({ className = "", size = 22, alt = "" }: Props) {
  return (
    <Image
      src="/tether-logo.png"
      alt={alt}
      width={size}
      height={size}
      className={`inline-block shrink-0 object-contain ${className}`}
    />
  );
}
