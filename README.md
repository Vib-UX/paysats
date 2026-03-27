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
