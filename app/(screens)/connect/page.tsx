import { InvoiceFundForm } from "@/components/wallet/invoice-fund-form";

export default function ConnectPage() {
  return (
    <main className="app-shell">
      <h1 className="mb-2 text-3xl font-black tracking-tight text-gold">paysats</h1>
      <p className="mb-6 text-sm text-zinc-300">
        Enter a sat amount to create a Lightning invoice. Pay with any wallet, then continue.
      </p>
      <InvoiceFundForm />
    </main>
  );
}
