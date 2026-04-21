# @paysats/sdk

Node client for the paysats API: send Bitcoin (Lightning or supported on-chain rails) and settle **IDR** to an Indonesian **bank account** or **e-wallet** you choose from the live payout list.

**Requirements:** Node 18+ and a server-side `PAYSATS_API_KEY` (never expose it in a browser).

## Install

```bash
npm install @paysats/sdk
```

## Usage

```ts
import { PaysatsClient } from "@paysats/sdk";

const client = new PaysatsClient({
  apiKey: process.env.PAYSATS_API_KEY!,
  // baseUrl: "https://your-api-host", // optional
});

const methods = await client.listPayoutMethods();
const payout = methods.find((m) => m.bankCode === "014")!;

const order = await client.createOfframpOrder({
  idrAmount: 50_000,
  depositChannel: "lightning",
  idrxBankCode: payout.bankCode,
  idrxBankName: payout.bankName,
  recipientDetails: "1234567890",
  bankAccountName: "Jane Doe",
});

// Lightning: show `order.bolt11` to the payer. On-chain rails: use `order.deposit`.
const final = await client.waitForOrder(order.orderId);
```

1. Call `listPayoutMethods()` and let the user pick a **bank** or **e-wallet** (`kind` is `"bank"` or `"ewallet"`).
2. Pass the row’s `bankCode` and `bankName` into `createOfframpOrder` as `idrxBankCode` and `idrxBankName` (names match the HTTP API).
3. For **e-wallets**, use the mobile format required by the API (see error messages if validation fails).
4. Poll with `getOrder` or block with `waitForOrder` until `state` is `COMPLETED` or `FAILED`.

Other methods: `getBtcIdrQuote`, `getDepositRails`, `getPlatformStats`, `listOrders`. Errors use `PaysatsApiError` (`status`, `body`).

## License

MIT
