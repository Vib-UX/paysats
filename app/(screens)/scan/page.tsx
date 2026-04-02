import { QrisScanner } from "@/components/scanner/qris-scanner";

export default function ScanPage() {
  return (
    <main className="app-shell">
      <h1 className="mb-2 text-2xl font-black text-white">Scan QRIS</h1>
      <p className="mb-6 text-sm leading-relaxed text-zinc-400">
        Point your camera at a merchant QRIS code. We read the amount so you can continue your Paysats flow.
      </p>
      <QrisScanner />
    </main>
  );
}
