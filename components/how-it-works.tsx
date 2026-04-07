import { TetherMark } from "@/components/tether-mark";

const STEPS = [
  {
    step: "1",
    title: "Set your amount",
    body: "Choose IDR or sats. We show the live conversion so you know exactly what you are paying on LN."
  },
  {
    step: "2",
    title: "Pay the invoice",
    body: "Complete the Bolt11 invoice in Alby, Phoenix, or any LN wallet. Your payment is verifiable on-chain via preimage."
  },
  {
    step: "3",
    title: "We route the rails",
    body: "Liquidity moves LN → USDT (Boltz) → Base: USDC + p2p.me for GoPay, or IDRX via LiFi for BCA bank — then IDRX burn/redeem to IDR."
  },
  {
    step: "4",
    title: "IDR hits your account",
    body: "BCA: the live route shows IDRX liquidating to IDR into the account you entered. GoPay: payout lands on the number you provided. Track progress on the order status screen."
  }
] as const;

type Props = { className?: string };

export function HowItWorks({ className = "mt-12" }: Props) {
  return (
    <section className={className} aria-labelledby="how-it-works-heading">
      <h2 id="how-it-works-heading" className="text-lg font-black text-white">
        How it works
      </h2>
      <p className="mt-2 text-sm leading-relaxed text-zinc-400">
        Paysats connects LN to IDR (bank and e-wallet) — no manual exchange.
      </p>
      <div className="mt-2 flex items-start gap-2 text-sm leading-relaxed text-zinc-500">
        <TetherMark size={22} className="mt-0.5" />
        <p>
          <span className="font-medium text-zinc-400">Powered by Tether:</span> WDK settles the USDT leg; agents route
          Boltz → LiFi → your payout.
        </p>
      </div>
      <ol className="mt-6 space-y-3">
        {STEPS.map((s) => (
          <li
            key={s.step}
            className="flex gap-4 rounded-2xl border border-border bg-card/80 p-4"
          >
            <span
              className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl gold-gradient text-sm font-black text-black"
              aria-hidden
            >
              {s.step}
            </span>
            <div className="min-w-0">
              <h3 className="font-bold text-zinc-100">{s.title}</h3>
              <p className="mt-1 text-sm leading-relaxed text-zinc-400">{s.body}</p>
            </div>
          </li>
        ))}
      </ol>
    </section>
  );
}
