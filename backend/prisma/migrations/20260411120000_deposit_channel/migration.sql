-- Optional: Lightning vs wrapped BTC (cbBTC / BTCB) deposit metadata for offramp orders
ALTER TABLE "Order" ADD COLUMN "depositChannel" TEXT;
ALTER TABLE "Order" ADD COLUMN "depositChainId" INTEGER;
ALTER TABLE "Order" ADD COLUMN "depositTokenAddress" TEXT;
ALTER TABLE "Order" ADD COLUMN "depositToAddress" TEXT;
