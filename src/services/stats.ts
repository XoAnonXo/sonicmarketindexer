import { ChainInfo, makeId, getDayTimestamp, getHourTimestamp } from "../utils/helpers";
import { withRetry } from "../utils/errors";

interface StatsUpdate {
  // Counters
  trades?: number;
  markets?: number;
  ammMarkets?: number;
  pariMarkets?: number;
  polls?: number;
  pollsResolved?: number;
  users?: number; // Total users (platform) or New users (daily)
  activeUsers?: number; // For daily stats
  
  // Financials (BigInt)
  volume?: bigint;
  tvlChange?: bigint; // Can be negative
  fees?: bigint;
  winningsPaid?: bigint;
}

/**
 * Centralized stats updater.
 * Updates PlatformStats, DailyStats, and HourlyStats in one go.
 */
export async function updateAggregateStats(
  context: any,
  chain: ChainInfo,
  timestamp: bigint,
  metrics: StatsUpdate
) {
  await withRetry(async () => {
    // 1. Update Platform Stats
    const platformId = chain.chainId.toString();
    let platformStats = await context.db.platformStats.findUnique({ id: platformId });

    if (!platformStats) {
      platformStats = await context.db.platformStats.create({
        id: platformId,
        data: {
          chainId: chain.chainId,
          chainName: chain.chainName,
          totalPolls: 0,
          totalPollsResolved: 0,
          totalMarkets: 0,
          totalTrades: 0,
          totalUsers: 0,
          totalVolume: 0n,
          totalLiquidity: 0n,
          totalFees: 0n,
          totalWinningsPaid: 0n,
          totalAmmMarkets: 0,
          totalPariMarkets: 0,
          lastUpdatedAt: 0n,
        },
      });
    }

    // Calculate new TVL (prevent negative)
    const currentLiquidity = platformStats.totalLiquidity ?? 0n;
    const tvlChange = metrics.tvlChange ?? 0n;
    let newLiquidity = currentLiquidity + tvlChange;
    if (newLiquidity < 0n) newLiquidity = 0n;

    await context.db.platformStats.update({
      id: platformId,
      data: {
        totalPolls: (platformStats.totalPolls ?? 0) + (metrics.polls ?? 0),
        totalPollsResolved: (platformStats.totalPollsResolved ?? 0) + (metrics.pollsResolved ?? 0),
        totalMarkets: (platformStats.totalMarkets ?? 0) + (metrics.markets ?? 0),
        totalAmmMarkets: (platformStats.totalAmmMarkets ?? 0) + (metrics.ammMarkets ?? 0),
        totalPariMarkets: (platformStats.totalPariMarkets ?? 0) + (metrics.pariMarkets ?? 0),
        totalTrades: (platformStats.totalTrades ?? 0) + (metrics.trades ?? 0),
        totalUsers: (platformStats.totalUsers ?? 0) + (metrics.users ?? 0), // Note: users here means TOTAL unique users
        totalVolume: (platformStats.totalVolume ?? 0n) + (metrics.volume ?? 0n),
        totalLiquidity: newLiquidity,
        totalFees: (platformStats.totalFees ?? 0n) + (metrics.fees ?? 0n),
        totalWinningsPaid: (platformStats.totalWinningsPaid ?? 0n) + (metrics.winningsPaid ?? 0n),
        lastUpdatedAt: timestamp,
      },
    });

    // 2. Update Daily Stats
    const dayTs = getDayTimestamp(timestamp);
    const dailyId = makeId(chain.chainId, dayTs.toString());
    let dailyStats = await context.db.dailyStats.findUnique({ id: dailyId });

    if (!dailyStats) {
      dailyStats = await context.db.dailyStats.create({
        id: dailyId,
        data: {
          chainId: chain.chainId,
          chainName: chain.chainName,
          dayTimestamp: dayTs,
          pollsCreated: 0,
          marketsCreated: 0,
          tradesCount: 0,
          volume: 0n,
          winningsPaid: 0n,
          newUsers: 0,
          activeUsers: 0,
        },
      });
    }

    await context.db.dailyStats.update({
      id: dailyId,
      data: {
        pollsCreated: (dailyStats.pollsCreated ?? 0) + (metrics.polls ?? 0),
        marketsCreated: (dailyStats.marketsCreated ?? 0) + (metrics.markets ?? 0),
        tradesCount: (dailyStats.tradesCount ?? 0) + (metrics.trades ?? 0),
        volume: (dailyStats.volume ?? 0n) + (metrics.volume ?? 0n),
        winningsPaid: (dailyStats.winningsPaid ?? 0n) + (metrics.winningsPaid ?? 0n),
        newUsers: (dailyStats.newUsers ?? 0) + (metrics.users ?? 0), // For daily, 'users' param implies NEW users
        activeUsers: (dailyStats.activeUsers ?? 0) + (metrics.activeUsers ?? 0),
      },
    });

    // 3. Update Hourly Stats (Only if there are trade/volume updates)
    if ((metrics.trades ?? 0) > 0 || (metrics.volume ?? 0n) > 0n) {
      const hourTs = getHourTimestamp(timestamp);
      const hourlyId = makeId(chain.chainId, hourTs.toString());
      let hourlyStats = await context.db.hourlyStats.findUnique({ id: hourlyId });

      if (!hourlyStats) {
        hourlyStats = await context.db.hourlyStats.create({
          id: hourlyId,
          data: {
            chainId: chain.chainId,
            chainName: chain.chainName,
            hourTimestamp: hourTs,
            tradesCount: 0,
            volume: 0n,
            uniqueTraders: 0,
          },
        });
      }

      await context.db.hourlyStats.update({
        id: hourlyId,
        data: {
          tradesCount: (hourlyStats.tradesCount ?? 0) + (metrics.trades ?? 0),
          volume: (hourlyStats.volume ?? 0n) + (metrics.volume ?? 0n),
        },
      });
    }
  });
}
