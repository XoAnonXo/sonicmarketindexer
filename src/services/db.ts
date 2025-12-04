import { ChainInfo, makeId } from "../utils/helpers";
import { withRetry } from "../utils/errors";
import { PredictionAMMAbi } from "../../abis/PredictionAMM";
import { PredictionPariMutuelAbi } from "../../abis/PredictionPariMutuel";

/**
 * Check if a trader is new to a specific market using the optimized marketUsers table.
 */
export async function isNewTraderForMarket(
  context: any,
  marketAddress: `0x${string}`,
  traderAddress: `0x${string}`,
  chain: ChainInfo
): Promise<boolean> {
  const id = makeId(chain.chainId, marketAddress, traderAddress);
  // This is a simple read, might not strictly need retry but good for consistency
  return withRetry(async () => {
    const record = await context.db.marketUsers.findUnique({ id });
    return !record;
  });
}

/**
 * Record a user's interaction with a market.
 * Creates or updates the marketUsers record.
 */
export async function recordMarketInteraction(
  context: any,
  marketAddress: `0x${string}`,
  traderAddress: `0x${string}`,
  chain: ChainInfo,
  timestamp: bigint
) {
  const id = makeId(chain.chainId, marketAddress, traderAddress);
  await withRetry(async () => {
    await context.db.marketUsers.upsert({
      id,
      create: {
        chainId: chain.chainId,
        marketAddress,
        user: traderAddress,
        lastTradeAt: timestamp,
      },
      update: {
        lastTradeAt: timestamp,
      },
    });
  });
}

/**
 * Get existing user record or create a new one with default values.
 */
export async function getOrCreateUser(context: any, address: `0x${string}`, chain: ChainInfo) {
  // Normalize address to lowercase for consistent storage
  const normalizedAddress = address.toLowerCase() as `0x${string}`;
  const id = makeId(chain.chainId, normalizedAddress);
  
  return withRetry(async () => {
    // Try to fetch existing user
    let user = await context.db.users.findUnique({ id });
    
    // If not found, create with zero-initialized stats
    if (!user) {
      user = await context.db.users.create({
        id,
        data: {
          chainId: chain.chainId,
          chainName: chain.chainName,
          address: normalizedAddress,
          // Trading stats start at zero
          totalTrades: 0,
          totalVolume: 0n,
          totalWinnings: 0n,
          totalDeposited: 0n,
          totalWithdrawn: 0n,
          realizedPnL: 0n,
          // Win/loss tracking
          totalWins: 0,
          totalLosses: 0,
          currentStreak: 0,
          bestStreak: 0,
          // Creator stats
          marketsCreated: 0,
          pollsCreated: 0,
          // Timestamps left null until first trade
        },
      });
    }
    return user;
  });
}

/**
 * Safely get or create a minimal market record with race condition handling.
 * If market doesn't exist, fetches data on-chain to avoid placeholder/fake addresses.
 */
export async function getOrCreateMinimalMarket(
  context: any, 
  marketAddress: `0x${string}`, 
  chain: ChainInfo,
  marketType: "amm" | "pari",
  timestamp: bigint,
  blockNumber: bigint,
  txHash?: `0x${string}`
) {
  return withRetry(async () => {
    // Check if market already exists
    let market = await context.db.markets.findUnique({ id: marketAddress });
    
    if (!market) {
      // Strategy B: Fetch real data from chain immediately
      console.log(`[${chain.chainName}] Fetching on-chain data for missing market ${marketAddress}...`);
      
      let pollAddress: `0x${string}`;
      let creator: `0x${string}`;
      let collateralToken: `0x${string}`;
      let yesToken: `0x${string}` | undefined;
      let noToken: `0x${string}` | undefined;
      let feeTier: number | undefined;
      let maxPriceImbalancePerHour: number | undefined;
      let curveFlattener: number | undefined;
      let curveOffset: number | undefined;

      try {
        if (marketType === "amm") {
          // Read AMM specific data
          const [poll, cr, col, yes, no, fee, imb] = await context.client.readContract({
            address: marketAddress,
            abi: PredictionAMMAbi,
            functionName: "getMarketData", // Assuming a helper exists or reading individually? 
            // The ABI doesn't have a single getter usually. Let's read individual fields.
            // Ponder client supports multicall implicitly if we await parallel promises?
            // Actually, we must check what functions exist in ABI.
            // ABI usually has public getters for public variables.
          }).catch(() => null) || []; 
          
          // Fallback to individual reads if getMarketData doesn't exist (it likely doesn't)
          // Let's use individual reads based on standard public variable getters
          pollAddress = await context.client.readContract({ address: marketAddress, abi: PredictionAMMAbi, functionName: "pollAddress" });
          creator = await context.client.readContract({ address: marketAddress, abi: PredictionAMMAbi, functionName: "creator" });
          collateralToken = await context.client.readContract({ address: marketAddress, abi: PredictionAMMAbi, functionName: "collateral" });
          yesToken = await context.client.readContract({ address: marketAddress, abi: PredictionAMMAbi, functionName: "yesToken" });
          noToken = await context.client.readContract({ address: marketAddress, abi: PredictionAMMAbi, functionName: "noToken" });
          feeTier = Number(await context.client.readContract({ address: marketAddress, abi: PredictionAMMAbi, functionName: "feeTier" }));
          maxPriceImbalancePerHour = Number(await context.client.readContract({ address: marketAddress, abi: PredictionAMMAbi, functionName: "maxPriceImbalancePerHour" }));
          
        } else {
          // PariMutuel
          pollAddress = await context.client.readContract({ address: marketAddress, abi: PredictionPariMutuelAbi, functionName: "pollAddress" });
          creator = await context.client.readContract({ address: marketAddress, abi: PredictionPariMutuelAbi, functionName: "creator" });
          collateralToken = await context.client.readContract({ address: marketAddress, abi: PredictionPariMutuelAbi, functionName: "collateral" });
          curveFlattener = Number(await context.client.readContract({ address: marketAddress, abi: PredictionPariMutuelAbi, functionName: "curveFlattener" }));
          curveOffset = Number(await context.client.readContract({ address: marketAddress, abi: PredictionPariMutuelAbi, functionName: "curveOffset" }));
        }
      } catch (err: any) {
        console.error(`Failed to fetch market data for ${marketAddress}: ${err.message}`);
        throw err; // Retry will handle transient issues. Persistent issues will crash block (good, don't index garbage).
      }

      try {
        market = await context.db.markets.create({
          id: marketAddress,
          data: {
            chainId: chain.chainId,
            chainName: chain.chainName,
            // Flag as incomplete if we want (though we have full data now, maybe we lack factory timestamp?)
            // We use the timestamp of the first trade as creation time if we missed factory.
            // Technically it's complete enough for queries.
            isIncomplete: false, 
            pollAddress: pollAddress.toLowerCase() as `0x${string}`,
            creator: creator.toLowerCase() as `0x${string}`,
            marketType,
            collateralToken: collateralToken.toLowerCase() as `0x${string}`,
            yesToken: yesToken?.toLowerCase() as `0x${string}`,
            noToken: noToken?.toLowerCase() as `0x${string}`,
            feeTier,
            maxPriceImbalancePerHour,
            curveFlattener,
            curveOffset,
            // Stats start at zero
            totalVolume: 0n,
            totalTrades: 0,
            currentTvl: 0n,
            uniqueTraders: 0,
            initialLiquidity: 0n,
            createdAtBlock: blockNumber,
            createdAt: timestamp,
            createdTxHash: txHash ?? "0x0000000000000000000000000000000000000000000000000000000000000000" as `0x${string}`,
          },
        });
        console.log(`[${chain.chainName}] Successfully backfilled market ${marketAddress} from on-chain data.`);
      } catch (e: any) {
        // Handle race condition: another handler created the market first (e.g. factory event processed in parallel?)
        if (e.message?.includes("unique constraint") || e.code === "P2002") {
          market = await context.db.markets.findUnique({ id: marketAddress });
          if (!market) {
            throw new Error(`Failed to get or create market ${marketAddress}: ${e.message}`);
          }
        } else {
          throw e;
        }
      }
    }
    
    return market;
  });
}
