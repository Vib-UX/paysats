import { QrisScanner } from "@/components/scanner/qris-scanner";

export default function ScanPage() {
  return (
    <main className="app-shell">
      <h1 className="mb-2 text-2xl font-black text-gold">Scan QRIS</h1>
      <p className="mb-6 text-sm text-zinc-300">Scan merchant QR and extract amount before routing.</p>
      <QrisScanner />
    </main>
  );
}
