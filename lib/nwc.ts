export interface NwcWalletInfo {
  alias: string;
  balanceSats: number;
}

export async function getNwcWalletInfo(connectionString: string): Promise<NwcWalletInfo> {
  if (!connectionString) {
    throw new Error("Missing NWC connection string.");
  }

  const { nwc } = await import("@getalby/sdk");
  const client = new nwc.NWCClient({ nostrWalletConnectUrl: connectionString });
  const info = await client.getInfo();
  const balance = await client.getBalance();

  return {
    alias: info.alias ?? "NWC Wallet",
    balanceSats: Number(balance.balance ?? 0)
  };
}

export async function payInvoiceWithNwc(connectionString: string, invoice: string): Promise<string> {
  const { nwc } = await import("@getalby/sdk");
  const client = new nwc.NWCClient({ nostrWalletConnectUrl: connectionString });
  const result = await client.payInvoice({ invoice });

  if (!result.preimage) {
    throw new Error("Invoice payment failed: missing preimage.");
  }

  return result.preimage;
}
