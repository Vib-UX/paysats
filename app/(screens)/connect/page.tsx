import { InvoiceFundForm } from "@/components/wallet/invoice-fund-form";

export default function ConnectPage() {
  return (
    <main className="app-shell">
      <h1 className="mb-2 text-3xl font-black tracking-tight text-white">Fund with Lightning</h1>
      <p className="mb-6 text-sm leading-relaxed text-zinc-400">
        Enter an amount in sats to generate a Lightning invoice. Pay with any wallet to continue.
      </p>
      <InvoiceFundForm />
    </main>
  );
}
