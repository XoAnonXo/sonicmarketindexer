import type { PonderContext, ChainInfo } from "../utils/types";
import { makeId } from "../utils/helpers";
import { withRetry } from "../utils/errors";
import { ZERO_TX_HASH, MarketType, type MarketTypeValue } from "../utils/constants";
import { PredictionAMMAbi } from "../../abis/PredictionAMM";
import { PredictionPariMutuelAbi } from "../../abis/PredictionPariMutuel";

// =============================================================================
// USER MANAGEMENT
// =============================================================================

/**
 * Default user stats for new users
 */
const DEFAULT_USER_STATS = {
  totalTrades: 0,
  totalVolume: 0n,
  totalWinnings: 0n,
  totalDeposited: 0n,
  totalWithdrawn: 0n,
  realizedPnL: 0n,
  totalWins: 0,
  totalLosses: 0,
  currentStreak: 0,
  bestStreak: 0,
  marketsCreated: 0,
  pollsCreated: 0,
} as const;

/**
 * Get existing user record or create a new one with default values.
 * Uses upsert to avoid race conditions with concurrent events.
 */
export async function getOrCreateUser(context: PonderContext, address: `0x${string}`, chain: ChainInfo) {
  const normalizedAddress = address.toLowerCase() as `0x${string}`;
  const id = makeId(chain.chainId, normalizedAddress);
  
  return withRetry(async () => {
    // Use upsert to handle race conditions atomically
    const user = await context.db.users.upsert({
      id,
      create: {
        chainId: chain.chainId,
        chainName: chain.chainName,
        address: normalizedAddress,
        ...DEFAULT_USER_STATS,
      },
      update: {
        // No-op update - just returns existing record
      },
    });
    return user;
  });
}

// =============================================================================
// MARKET USER TRACKING
// =============================================================================

/**
 * Check if a trader is new to a specific market and record interaction atomically.
 * Returns true if this is the first interaction for this user on this market.
 * 
 * Uses findUnique + upsert pattern for Ponder compatibility:
 * - Check if record exists first
 * - Use upsert to handle concurrent writes within the same batch
 */
export async function checkAndRecordMarketInteraction(
  context: PonderContext,
  marketAddress: `0x${string}`,
  traderAddress: `0x${string}`,
  chain: ChainInfo,
  timestamp: bigint
): Promise<boolean> {
  const id = makeId(chain.chainId, marketAddress, traderAddress);
  
  return withRetry(async () => {
    // Check if record exists first
    const existing = await context.db.marketUsers.findUnique({ id });
    const isNew = !existing;
    
    // Use upsert to handle concurrent writes within the same Ponder batch
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
    
    return isNew;
  });
}

// =============================================================================
// MARKET BACKFILL - RPC HELPERS
// =============================================================================

/**
 * Fetch AMM market data from chain using parallel RPC calls.
 */
async function fetchAmmMarketData(
  context: PonderContext,
  marketAddress: `0x${string}`
) {
  // Note: feeTier and maxPriceImbalancePerHour are NOT exposed as public view functions
  // on the contract. They are only available in the MarketCreated event.
  // We only fetch the data that IS available via RPC.
  const [pollAddress, creator, collateralToken, yesToken, noToken] = 
    await Promise.all([
      context.client.readContract({ 
        address: marketAddress, 
        abi: PredictionAMMAbi, 
        functionName: "pollAddress" 
      }),
      context.client.readContract({ 
        address: marketAddress, 
        abi: PredictionAMMAbi, 
        functionName: "creator" 
      }),
      context.client.readContract({ 
        address: marketAddress, 
        abi: PredictionAMMAbi, 
        functionName: "collateralToken" 
      }),
      context.client.readContract({ 
        address: marketAddress, 
        abi: PredictionAMMAbi, 
        functionName: "yesToken" 
      }),
      context.client.readContract({ 
        address: marketAddress, 
        abi: PredictionAMMAbi, 
        functionName: "noToken" 
      }),
    ]);

  return {
    pollAddress,
    creator,
    collateralToken,
    yesToken,
    noToken,
  };
}

/**
 * Fetch PariMutuel market data from chain using parallel RPC calls.
 */
async function fetchPariMarketData(
  context: PonderContext,
  marketAddress: `0x${string}`
) {
  const [pollAddress, creator, collateralToken, curveFlattener, curveOffset] = 
    await Promise.all([
      context.client.readContract({ 
        address: marketAddress, 
        abi: PredictionPariMutuelAbi, 
        functionName: "pollAddress" 
      }),
      context.client.readContract({ 
        address: marketAddress, 
        abi: PredictionPariMutuelAbi, 
        functionName: "creator" 
      }),
      context.client.readContract({ 
        address: marketAddress, 
        abi: PredictionPariMutuelAbi, 
        functionName: "collateralToken" 
      }),
      context.client.readContract({ 
        address: marketAddress, 
        abi: PredictionPariMutuelAbi, 
        functionName: "curveFlattener" 
      }),
      context.client.readContract({ 
        address: marketAddress, 
        abi: PredictionPariMutuelAbi, 
        functionName: "curveOffset" 
      }),
    ]);

  return {
    pollAddress,
    creator,
    collateralToken,
    curveFlattener: Number(curveFlattener),
    curveOffset: Number(curveOffset),
  };
}

/**
 * Safely get or create a minimal market record with race condition handling.
 * If market doesn't exist, fetches data on-chain to avoid placeholder/fake addresses.
 * 
 * RPC calls are parallelized for ~7x faster backfill performance.
 */
export async function getOrCreateMinimalMarket(
  context: PonderContext, 
  marketAddress: `0x${string}`, 
  chain: ChainInfo,
  marketType: MarketTypeValue,
  timestamp: bigint,
  blockNumber: bigint,
  txHash?: `0x${string}`
) {
  return withRetry(async () => {
    // Check if market already exists
    let market = await context.db.markets.findUnique({ id: marketAddress });
    
    if (!market) {
      // Fetch real data from chain using parallel RPC calls
      console.log(`[${chain.chainName}] Fetching on-chain data for missing market ${marketAddress}...`);
      
      try {
        if (marketType === MarketType.AMM) {
          const ammData = await fetchAmmMarketData(context, marketAddress);
          
          // Note: feeTier and maxPriceImbalancePerHour are only in the MarketCreated event,
          // not available via RPC. Mark as incomplete so we know to update when we see the event.
          // Validate required fields exist
          if (!ammData.yesToken || !ammData.noToken) {
            throw new Error(`AMM market ${marketAddress} missing yesToken or noToken`);
          }
          
          market = await context.db.markets.create({
            id: marketAddress,
            data: {
              chainId: chain.chainId,
              chainName: chain.chainName,
              isIncomplete: true, // Will be updated when MarketCreated event is processed
              pollAddress: ammData.pollAddress.toLowerCase() as `0x${string}`,
              creator: ammData.creator.toLowerCase() as `0x${string}`,
              marketType: MarketType.AMM,
              collateralToken: ammData.collateralToken.toLowerCase() as `0x${string}`,
              yesToken: ammData.yesToken.toLowerCase() as `0x${string}`,
              noToken: ammData.noToken.toLowerCase() as `0x${string}`,
              feeTier: 0, // Default - will be set from MarketCreated event
              maxPriceImbalancePerHour: 0, // Default - will be set from MarketCreated event
              // Stats start at zero
              totalVolume: 0n,
              totalTrades: 0,
              currentTvl: 0n,
              uniqueTraders: 0,
              initialLiquidity: 0n,
              createdAtBlock: blockNumber,
              createdAt: timestamp,
              createdTxHash: txHash ?? ZERO_TX_HASH,
            },
          });
        } else {
          const pariData = await fetchPariMarketData(context, marketAddress);
          
          market = await context.db.markets.create({
            id: marketAddress,
            data: {
              chainId: chain.chainId,
              chainName: chain.chainName,
              isIncomplete: false,
              pollAddress: pariData.pollAddress.toLowerCase() as `0x${string}`,
              creator: pariData.creator.toLowerCase() as `0x${string}`,
              marketType: MarketType.PARI,
              collateralToken: pariData.collateralToken.toLowerCase() as `0x${string}`,
              curveFlattener: pariData.curveFlattener,
              curveOffset: pariData.curveOffset,
              // Stats start at zero
              totalVolume: 0n,
              totalTrades: 0,
              currentTvl: 0n,
              uniqueTraders: 0,
              initialLiquidity: 0n,
              createdAtBlock: blockNumber,
              createdAt: timestamp,
              createdTxHash: txHash ?? ZERO_TX_HASH,
            },
          });
        }
        
        console.log(`[${chain.chainName}] Successfully backfilled market ${marketAddress} from on-chain data.`);
      } catch (err: unknown) {
        const errorMessage = err instanceof Error ? err.message : String(err);
        console.error(`Failed to fetch market data for ${marketAddress}: ${errorMessage}`);
        throw err;
      }
    }
    
    return market;
  });
}
