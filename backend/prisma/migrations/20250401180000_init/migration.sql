-- CreateSchema
CREATE SCHEMA IF NOT EXISTS "public";

-- CreateEnum
CREATE TYPE "OrderState" AS ENUM ('IDLE', 'NWC_CONNECTED', 'QR_SCANNED', 'ROUTE_SHOWN', 'LN_INVOICE_PAID', 'BOLTZ_SWAP_PENDING', 'USDT_RECEIVED', 'USDC_SWAPPED', 'P2PM_ORDER_PLACED', 'P2PM_ORDER_CONFIRMED', 'IDR_SETTLED', 'COMPLETED', 'FAILED');

-- CreateTable
CREATE TABLE "Order" (
    "id" TEXT NOT NULL,
    "state" "OrderState" NOT NULL DEFAULT 'IDLE',
    "satAmount" INTEGER NOT NULL DEFAULT 0,
    "usdtAmount" DOUBLE PRECISION,
    "usdcAmount" DOUBLE PRECISION,
    "idrAmount" DOUBLE PRECISION,
    "btcIdr" DOUBLE PRECISION,
    "btcIdrFetchedAt" TIMESTAMP(3),
    "boltzSwapId" TEXT,
    "boltzLnInvoice" TEXT,
    "boltzLnPreimage" TEXT,
    "boltzTxHash" TEXT,
    "swapTxHash" TEXT,
    "p2pmOrderId" TEXT,
    "p2pmPayoutMethod" TEXT,
    "payoutRecipient" TEXT,
    "invoiceBolt11" TEXT,
    "invoiceExpiresAt" TIMESTAMP(3),
    "invoicePaidAt" TIMESTAMP(3),
    "invoicePaymentHash" TEXT,
    "merchantName" TEXT,
    "qrisPayload" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "completedAt" TIMESTAMP(3),

    CONSTRAINT "Order_pkey" PRIMARY KEY ("id")
);
