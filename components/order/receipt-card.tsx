interface Props {
  sats: number;
  usdt: number;
  usdc: number;
  idr: number;
  merchant: string;
  boltzTxHash?: string;
  swapTxHash?: string;
  p2pmOrderId?: string;
}

export function ReceiptCard(props: Props) {
  return (
    <div className="rounded-2xl border border-border bg-card p-4 text-sm">
      <h2 className="mb-3 text-base font-bold text-gold">Settlement Receipt</h2>
      <p>Sats sent: {props.sats.toLocaleString()} sats</p>
      <p>USDT received: {props.usdt.toFixed(2)}</p>
      <p>USDC swapped: {props.usdc.toFixed(2)}</p>
      <p>IDR delivered: Rp {props.idr.toLocaleString()}</p>
      <p>Merchant: {props.merchant}</p>
      <p>Boltz tx: {props.boltzTxHash || "-"}</p>
      <p>Swap tx: {props.swapTxHash || "-"}</p>
      <p>p2p.me order: {props.p2pmOrderId || "-"}</p>
    </div>
  );
}
