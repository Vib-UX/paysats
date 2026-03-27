import { NWCClient } from "@getalby/sdk";
import { log } from "./logger.js";

export type NwcClient = NWCClient;

export interface NwcWallet {
  client: NwcClient;
  balanceSats: number;
  /** Millisats from NWC `get_balance` (NIP-47). */
  balanceRaw: number;
  walletAlias?: string;
}

export interface PaymentResult {
  preimage: string;
  feesPaid: number;
}

export interface InvoiceResult {
  bolt11: string;
  expiresAt?: number;
}

/**
 * Connects to the wallet behind `NWC_URL` and reads its reported Lightning balance.
 * `balanceSats` is derived from the NWC response (Alby-style wallets often return millisats in `balance`).
 */
export async function initNwc(nwcUrl: string): Promise<NwcWallet> {
  log.info("nwc", "connecting NWC client", { nwcUrl: log.redactNwcUrl(nwcUrl) });

  const client = new NWCClient({
    nostrWalletConnectUrl: nwcUrl
  });

  let walletAlias: string | undefined;
  try {
    const info = await client.getInfo();
    walletAlias = info.alias ?? undefined;
    log.info("nwc", "get_info ok", { alias: walletAlias ?? "(none)" });
  } catch (e) {
    log.warn("nwc", "get_info failed (continuing)", { error: e instanceof Error ? e.message : String(e) });
  }

  const bal = await client.getBalance();
  /** NIP-47: `balance` is millisats. */
  const balanceMsat = Number(bal.balance ?? 0);
  const balanceSats = Math.floor(balanceMsat / 1000);

  log.info("nwc", "wallet balance snapshot (NIP-47 get_balance)", {
    walletAlias: walletAlias ?? "(unknown)",
    balanceMsat,
    balanceSats
  });

  return { client, balanceSats, balanceRaw: balanceMsat, walletAlias };
}

export async function payInvoice(client: NwcClient, bolt11: string): Promise<PaymentResult> {
  log.info("nwc", "pay_invoice request", { invoicePrefix: bolt11.slice(0, 24) + "…" });
  const result = await client.payInvoice({ invoice: bolt11 });
  log.info("nwc", "pay_invoice ok", { preimageLen: result.preimage?.length ?? 0 });
  return {
    preimage: result.preimage,
    feesPaid: (result as any).fees_paid ?? 0
  };
}

export async function createInvoice(
  client: NwcClient,
  amountSats: number,
  description = "paysats topup"
): Promise<InvoiceResult> {
  log.info("nwc", "make_invoice", { amountSats, description });
  const result = await client.makeInvoice({
    amount: amountSats * 1000,
    description
  });

  log.info("nwc", "make_invoice ok", { invoiceLen: result.invoice?.length ?? 0 });
  return {
    bolt11: result.invoice,
    expiresAt: (result as any).expires_at
  };
}
