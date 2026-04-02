type Props = { className?: string };

export function MerchantCta({ className = "mt-12 scroll-mt-24" }: Props) {
  return (
    <section
      id="merchant"
      className={`rounded-2xl border border-gold/30 bg-gradient-to-br from-gold/10 via-card to-card p-6 ${className}`}
      aria-labelledby="merchant-heading"
    >
      <h2 id="merchant-heading" className="text-lg font-black text-white">
        Become a merchant
      </h2>
      <p className="mt-3 text-sm leading-relaxed text-zinc-300">
        Accept Lightning at checkout, settle to IDR, and give customers a fast path from global bitcoin liquidity to
        local payment rails. We are onboarding partners who want QRIS-ready flows and transparent settlement.
      </p>
      <a
        href="mailto:merchant@paysats.id?subject=Paysats%20merchant%20inquiry"
        className="tap-target mt-5 inline-flex w-full items-center justify-center rounded-2xl gold-gradient px-4 py-3 text-center text-sm font-black text-black sm:w-auto"
      >
        Talk to us
      </a>
    </section>
  );
}
