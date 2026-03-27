export interface TwdkWallet {
  address: string;
  network: "base";
}

export async function getTwdkWalletAddress(): Promise<string> {
  if (!process.env.NEXT_PUBLIC_DEFAULT_BASE_ADDRESS) {
    throw new Error("Missing NEXT_PUBLIC_DEFAULT_BASE_ADDRESS for fallback wallet address.");
  }

  return process.env.NEXT_PUBLIC_DEFAULT_BASE_ADDRESS;
}
