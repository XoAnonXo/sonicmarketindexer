import { ponder } from "@/generated";
import { getChainInfo, makeId } from "../utils/helpers";
import { MarketType, ZERO_ADDRESS } from "../utils/constants";
import { updateAggregateStats } from "../services/stats";
import { getOrCreateUser } from "../services/db";

// =============================================================================
// AMM MARKET CREATED
// =============================================================================

ponder.on("MarketFactory:MarketCreated", async ({ event, context }) => {
  const { 
    pollAddress, 
    marketAddress, 
    creator, 
    yesToken, 
    noToken, 
    collateral, 
    feeTier,
    maxPriceImbalancePerHour,
  } = event.args;
  const timestamp = event.block.timestamp;
  const chain = getChainInfo(context);

  const existingMarket = await context.db.markets.findUnique({ id: marketAddress });
  
  const marketData = {
    chainId: chain.chainId,
    chainName: chain.chainName,
    pollAddress,
    creator: creator.toLowerCase() as `0x${string}`,
    marketType: MarketType.AMM,
    isIncomplete: false,
    collateralToken: collateral,
    yesToken,
    noToken,
    feeTier: Number(feeTier),
    maxPriceImbalancePerHour: Number(maxPriceImbalancePerHour),
    createdAtBlock: event.block.number,
    createdAt: timestamp,
    createdTxHash: event.transaction.hash,
  };

  if (existingMarket) {
    await context.db.markets.update({
      id: marketAddress,
      data: {
        ...marketData,
        // Preserve existing stats
        totalVolume: existingMarket.totalVolume,
        totalTrades: existingMarket.totalTrades,
        currentTvl: existingMarket.currentTvl,
        uniqueTraders: existingMarket.uniqueTraders,
        initialLiquidity: existingMarket.initialLiquidity ?? 0n,
        reserveYes: existingMarket.reserveYes ?? 0n,
        reserveNo: existingMarket.reserveNo ?? 0n,
      },
    });
  } else {
    await context.db.markets.create({
      id: marketAddress,
      data: {
        ...marketData,
        totalVolume: 0n,
        totalTrades: 0,
        currentTvl: 0n,
        uniqueTraders: 0,
        initialLiquidity: 0n,
        reserveYes: 0n,
        reserveNo: 0n,
      },
    });
  }

  const normalizedPollAddress = pollAddress.toLowerCase() as `0x${string}`;

  // Fix orphaned records from race conditions
  // (when trade/liquidity events are indexed before MarketCreated in same block)
  await Promise.all([
    context.db.trades.updateMany({
      where: { marketAddress, pollAddress: ZERO_ADDRESS },
      data: { pollAddress: normalizedPollAddress },
    }),
    context.db.trades.updateMany({
      where: { marketAddress, pollAddress: marketAddress },
      data: { pollAddress: normalizedPollAddress },
    }),
    context.db.liquidityEvents.updateMany({
      where: { marketAddress, pollAddress: ZERO_ADDRESS },
      data: { pollAddress: normalizedPollAddress },
    }),
    context.db.liquidityEvents.updateMany({
      where: { marketAddress, pollAddress: marketAddress },
      data: { pollAddress: normalizedPollAddress },
    }),
    context.db.userMarketPositions.updateMany({
      where: { marketAddress, pollAddress: ZERO_ADDRESS },
      data: { pollAddress: normalizedPollAddress },
    }),
    context.db.userMarketPositions.updateMany({
      where: { marketAddress, pollAddress: marketAddress },
      data: { pollAddress: normalizedPollAddress },
    }),
  ]);

  const user = await getOrCreateUser(context, creator, chain);
  await context.db.users.update({
    id: makeId(chain.chainId, creator.toLowerCase()),
    data: {
      marketsCreated: user.marketsCreated + 1,
    },
  });

  await updateAggregateStats(context, chain, timestamp, {
    markets: 1,
    ammMarkets: 1,
  });

  console.log(`[${chain.chainName}] AMM market created: ${marketAddress}`);
});

// =============================================================================
// PARIMUTUEL MARKET CREATED
// =============================================================================

ponder.on("MarketFactory:PariMutuelCreated", async ({ event, context }) => {
  const { 
    pollAddress, 
    marketAddress, 
    creator, 
    collateral,
    curveFlattener,
    curveOffset,
  } = event.args;
  const timestamp = event.block.timestamp;
  const chain = getChainInfo(context);

  const existingMarket = await context.db.markets.findUnique({ id: marketAddress });
  
  const marketData = {
    chainId: chain.chainId,
    chainName: chain.chainName,
    pollAddress,
    creator: creator.toLowerCase() as `0x${string}`,
    marketType: MarketType.PARI,
    isIncomplete: false,
    collateralToken: collateral,
    curveFlattener: Number(curveFlattener),
    curveOffset: Number(curveOffset),
    createdAtBlock: event.block.number,
    createdAt: timestamp,
    createdTxHash: event.transaction.hash,
  };

  if (existingMarket) {
    await context.db.markets.update({
      id: marketAddress,
      data: {
        ...marketData,
        // Preserve existing stats
        totalVolume: existingMarket.totalVolume,
        totalTrades: existingMarket.totalTrades,
        currentTvl: existingMarket.currentTvl,
        uniqueTraders: existingMarket.uniqueTraders,
        initialLiquidity: existingMarket.initialLiquidity ?? 0n,
      },
    });
  } else {
    await context.db.markets.create({
      id: marketAddress,
      data: {
        ...marketData,
        totalVolume: 0n,
        totalTrades: 0,
        currentTvl: 0n,
        uniqueTraders: 0,
        initialLiquidity: 0n,
      },
    });
  }

  const normalizedPollAddress = pollAddress.toLowerCase() as `0x${string}`;

  // Fix orphaned records from race conditions
  // (when trade/liquidity events are indexed before PariMutuelCreated in same block)
  await Promise.all([
    context.db.trades.updateMany({
      where: { marketAddress, pollAddress: ZERO_ADDRESS },
      data: { pollAddress: normalizedPollAddress },
    }),
    context.db.trades.updateMany({
      where: { marketAddress, pollAddress: marketAddress },
      data: { pollAddress: normalizedPollAddress },
    }),
    context.db.userMarketPositions.updateMany({
      where: { marketAddress, pollAddress: ZERO_ADDRESS },
      data: { pollAddress: normalizedPollAddress },
    }),
    context.db.userMarketPositions.updateMany({
      where: { marketAddress, pollAddress: marketAddress },
      data: { pollAddress: normalizedPollAddress },
    }),
  ]);

  const user = await getOrCreateUser(context, creator, chain);
  await context.db.users.update({
    id: makeId(chain.chainId, creator.toLowerCase()),
    data: {
      marketsCreated: user.marketsCreated + 1,
    },
  });

  await updateAggregateStats(context, chain, timestamp, {
    markets: 1,
    pariMarkets: 1,
  });

  console.log(`[${chain.chainName}] PariMutuel market created: ${marketAddress}`);
});
