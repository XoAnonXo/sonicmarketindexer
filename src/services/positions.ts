import type { PonderContext, ChainInfo } from "../utils/types";
import { makeId } from "../utils/helpers";
import { withRetry } from "../utils/errors";
import { TradeSide, PollStatus } from "../utils/constants";

// =============================================================================
// POSITION TRACKING
// =============================================================================

/**
 * Record or update a user's position in a market.
 * Called when a user buys YES or NO tokens/shares.
 */
export async function recordPosition(
  context: PonderContext,
  chain: ChainInfo,
  marketAddress: `0x${string}`,
  pollAddress: `0x${string}`,
  userAddress: `0x${string}`,
  side: typeof TradeSide.YES | typeof TradeSide.NO,
  collateralAmount: bigint,
  tokenAmount: bigint,
  timestamp: bigint
) {
  const normalizedUser = userAddress.toLowerCase() as `0x${string}`;
  const id = makeId(chain.chainId, marketAddress, normalizedUser);

  await withRetry(async () => {
    const existing = await context.db.userMarketPositions.findUnique({ id });

    if (!existing) {
      // Create new position
      await context.db.userMarketPositions.create({
        id,
        data: {
          chainId: chain.chainId,
          marketAddress,
          pollAddress,
          user: normalizedUser,
          yesAmount: side === TradeSide.YES ? collateralAmount : 0n,
          noAmount: side === TradeSide.NO ? collateralAmount : 0n,
          yesTokens: side === TradeSide.YES ? tokenAmount : 0n,
          noTokens: side === TradeSide.NO ? tokenAmount : 0n,
          hasRedeemed: false,
          lossRecorded: false,
          firstPositionAt: timestamp,
          lastUpdatedAt: timestamp,
        },
      });
    } else {
      // Update existing position
      await context.db.userMarketPositions.update({
        id,
        data: {
          yesAmount: side === TradeSide.YES 
            ? existing.yesAmount + collateralAmount 
            : existing.yesAmount,
          noAmount: side === TradeSide.NO 
            ? existing.noAmount + collateralAmount 
            : existing.noAmount,
          yesTokens: side === TradeSide.YES 
            ? existing.yesTokens + tokenAmount 
            : existing.yesTokens,
          noTokens: side === TradeSide.NO 
            ? existing.noTokens + tokenAmount 
            : existing.noTokens,
          lastUpdatedAt: timestamp,
        },
      });
    }
  });
}

/**
 * Reduce a user's position when they sell tokens.
 * Called when a user sells YES or NO tokens (AMM only).
 */
export async function reducePosition(
  context: PonderContext,
  chain: ChainInfo,
  marketAddress: `0x${string}`,
  userAddress: `0x${string}`,
  side: typeof TradeSide.YES | typeof TradeSide.NO,
  tokenAmount: bigint,
  timestamp: bigint
) {
  const normalizedUser = userAddress.toLowerCase() as `0x${string}`;
  const id = makeId(chain.chainId, marketAddress, normalizedUser);

  await withRetry(async () => {
    const existing = await context.db.userMarketPositions.findUnique({ id });

    if (existing) {
      // Reduce token holdings (don't go below 0)
      const newYesTokens = side === TradeSide.YES
        ? (existing.yesTokens > tokenAmount ? existing.yesTokens - tokenAmount : 0n)
        : existing.yesTokens;
      const newNoTokens = side === TradeSide.NO
        ? (existing.noTokens > tokenAmount ? existing.noTokens - tokenAmount : 0n)
        : existing.noTokens;

      await context.db.userMarketPositions.update({
        id,
        data: {
          yesTokens: newYesTokens,
          noTokens: newNoTokens,
          lastUpdatedAt: timestamp,
        },
      });
    }
  });
}

/**
 * Mark a position as redeemed when user claims winnings.
 */
export async function markPositionRedeemed(
  context: PonderContext,
  chain: ChainInfo,
  marketAddress: `0x${string}`,
  userAddress: `0x${string}`
) {
  const normalizedUser = userAddress.toLowerCase() as `0x${string}`;
  const id = makeId(chain.chainId, marketAddress, normalizedUser);

  await withRetry(async () => {
    const existing = await context.db.userMarketPositions.findUnique({ id });
    if (existing && !existing.hasRedeemed) {
      await context.db.userMarketPositions.update({
        id,
        data: {
          hasRedeemed: true,
        },
      });
    }
  });
}

// =============================================================================
// LOSS DETECTION
// =============================================================================

interface LossResult {
  user: `0x${string}`;
  lostAmount: bigint;
}

/**
 * Process losses for a resolved poll.
 * 
 * Called when a poll is resolved (AnswerSet event).
 * Finds all users who had positions on the losing side and:
 * 1. Returns their loss amounts
 * 2. Marks their positions as lossRecorded
 * 
 * @param pollStatus - The resolved status (1=YES wins, 2=NO wins, 3=Unknown/refund)
 * @returns Array of users who lost and their loss amounts
 */
export async function processLossesForPoll(
  context: PonderContext,
  chain: ChainInfo,
  pollAddress: `0x${string}`,
  pollStatus: number
): Promise<LossResult[]> {
  // Skip if outcome is unknown (refund - no losses)
  if (pollStatus === PollStatus.UNKNOWN || pollStatus === PollStatus.PENDING) {
    return [];
  }

  const losses: LossResult[] = [];

  // Determine which side lost
  const losingSide = pollStatus === PollStatus.YES ? 'no' : 'yes';

  await withRetry(async () => {
    // Find all markets linked to this poll
    // Note: Ponder's findMany may have limits, we'll work within constraints
    const markets = await context.db.markets.findMany({
      where: {
        pollAddress: pollAddress,
        chainId: chain.chainId,
      },
    });

    for (const market of markets.items) {
      // Find all positions for this market that haven't been processed
      const positions = await context.db.userMarketPositions.findMany({
        where: {
          marketAddress: market.id,
          chainId: chain.chainId,
          lossRecorded: false,
          hasRedeemed: false, // Users who redeemed are winners, not losers
        },
      });

      for (const position of positions.items) {
        // Check if user had a position on the losing side
        const lostAmount = losingSide === 'yes' 
          ? position.yesAmount 
          : position.noAmount;

        if (lostAmount > 0n) {
          losses.push({
            user: position.user,
            lostAmount,
          });

          // Mark position as loss recorded
          await context.db.userMarketPositions.update({
            id: position.id,
            data: {
              lossRecorded: true,
            },
          });
        }
      }
    }
  });

  return losses;
}

/**
 * Update user stats for a loss.
 */
export async function recordUserLoss(
  context: PonderContext,
  chain: ChainInfo,
  userAddress: `0x${string}`
) {
  const normalizedUser = userAddress.toLowerCase() as `0x${string}`;
  const userId = makeId(chain.chainId, normalizedUser);

  await withRetry(async () => {
    const user = await context.db.users.findUnique({ id: userId });
    
    if (user) {
      // Update streak (goes negative for consecutive losses)
      const newStreak = user.currentStreak <= 0 
        ? user.currentStreak - 1 
        : -1;

      await context.db.users.update({
        id: userId,
        data: {
          totalLosses: user.totalLosses + 1,
          currentStreak: newStreak,
        },
      });
    }
  });
}

