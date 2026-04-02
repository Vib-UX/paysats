import Link from "next/link";
import { PaysatsLogo } from "@/components/paysats-logo";

export function SiteHeader() {
  return (
    <header className="sticky top-0 z-40 border-b border-border bg-bg/90 backdrop-blur-md">
      <div className="mx-auto flex max-w-lg items-center justify-between gap-3 px-4 py-3">
        <Link href="/offramp" className="tap-target flex min-w-0 items-center" aria-label="Paysats home">
          <PaysatsLogo className="text-xl" />
        </Link>
        <nav className="flex shrink-0 items-center gap-1">
          <Link
            href="/offramp#merchant"
            className="tap-target rounded-full px-3 py-2 text-sm font-bold text-zinc-300 transition hover:text-gold"
          >
            Become a Merchant
          </Link>
        </nav>
      </div>
    </header>
  );
}
