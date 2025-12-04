import type { PonderContext, ChainInfo } from "../utils/types";
import { makeId } from "../utils/helpers";
import { withRetry } from "../utils/errors";
import { ZERO_TX_HASH, MarketType, type MarketTypeValue } from "../utils/constants";

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
// MARKET PLACEHOLDER
// =============================================================================
// Note: RPC backfill removed to speed up historical sync.
// Markets are created as placeholders and updated when factory events are processed.

/**
 * Safely get or create a minimal market record.
 * 
 * Creates a placeholder market that will be fully populated when the MarketCreated
 * event is processed. This avoids RPC calls during historical sync which can cause
 * rate limiting and memory issues.
 * 
 * The placeholder uses the market address as pollAddress temporarily - it will be
 * corrected when the factory event is processed.
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
      // Create placeholder - will be updated when MarketCreated event is processed
      // This avoids expensive RPC calls during historical sync
      console.log(`[${chain.chainName}] Creating placeholder market ${marketAddress} (will be updated by factory event)`);
      
      const placeholderAddress = marketAddress; // Use market address as temp pollAddress
      
      if (marketType === MarketType.AMM) {
        market = await context.db.markets.create({
          id: marketAddress,
          data: {
            chainId: chain.chainId,
            chainName: chain.chainName,
            isIncomplete: true, // Will be updated when MarketCreated event is processed
            pollAddress: placeholderAddress,
            creator: placeholderAddress, // Placeholder
            marketType: MarketType.AMM,
            collateralToken: placeholderAddress, // Placeholder
            yesToken: placeholderAddress, // Placeholder
            noToken: placeholderAddress, // Placeholder
            feeTier: 0,
            maxPriceImbalancePerHour: 0,
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
        market = await context.db.markets.create({
          id: marketAddress,
          data: {
            chainId: chain.chainId,
            chainName: chain.chainName,
            isIncomplete: true, // Will be updated when PariMutuelCreated event is processed
            pollAddress: placeholderAddress,
            creator: placeholderAddress, // Placeholder
            marketType: MarketType.PARI,
            collateralToken: placeholderAddress, // Placeholder
            curveFlattener: 0,
            curveOffset: 0,
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
    }
    
    return market;
  });
}
