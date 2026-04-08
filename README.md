# paysats

Mobile-first Lightning to QRIS settlement app.

## Project layout

- `app`, `components`, `lib` -> Next.js frontend (UI + invoice QR + QR scanner flow)
- `backend` -> Railway-deployable API service (Express + Prisma + automation stubs)
- `.cursor/mcp.json` -> MCP config including `wdk-docs`

## Local development

Frontend:

```bash
npm install
cp .env.example .env
npm run dev
```

Backend:

```bash
cd backend
npm install
cp .env.example .env
npx prisma generate
npx prisma migrate dev -n init
npm run dev
```

## Environment variables

Frontend (`.env`):

- `NEXT_PUBLIC_DEFAULT_BASE_ADDRESS`
- `NEXT_PUBLIC_BACKEND_URL` (for example `http://localhost:8080`)

Lightning invoices are created on the **backend** using `NWC_URL` (never paste NWC into the app).

Backend (`backend/.env`):

- `DATABASE_URL`
- `PORT`
- `NWC_URL` (Nostr Wallet Connect URL for the operator wallet — server-side only)
- `WDK_SEED` (for Tether WDK when you wire wallet signing)

## Railway deployment

Deploy `backend` as a separate Railway service, using:

- Root directory: `backend`
- Start command: `npm run start` (after build) or `npm run dev` for non-prod

## WDK MCP integration

Project MCP config includes:

- Server name: `wdk-docs`
- URL: `https://docs.wallet.tether.io/~gitbook/mcp`

## IDRX · BCA bank path (reference)

End-to-end: Lightning → Boltz (LN→USDT Arbitrum) → LiFi USDT→IDRX Base → `burnWithAccountNumber` on Base (ERC-4337, USDC paymaster) → signed `redeem-request` to IDRX.

Example explorer links from a successful run (hashes are illustrative; yours will differ per order):

| Step | Link |
|------|------|
| LiFi USDT → IDRX (userOp / bundle on Arbitrum) | [Arbiscan tx `0x0c3a9014…`](https://arbiscan.io/tx/0x0c3a9014df697efbc2d65911700238dcba3b06c1defcc448586d8625017b52fa) |
| IDRX burn on Base (bundle tx — use this hash for redeem `txHash`) | [Basescan tx `0xe0f59942…`](https://basescan.org/tx/0xe0f599423181d65e91d5464e344691505a8c8c27d2c7fe329052411eeb6bdd7b) |
| Redeem API | `POST https://idrx.co/api/transaction/redeem-request` — response includes `data.id`, `custRefNumber`, etc. (see IDRX dashboard for status). |

**Offramp UI (BCA):** users enter **IDR amount**, **BCA account number**, and **account holder name**. The pipeline uses that IDR target for burn/redeem (capped by on-chain IDRX balance after the bridge). Scripts: `npm run idrx:redeem:bca`, `npm run burn:idrx` (see `backend/.env.example`).
