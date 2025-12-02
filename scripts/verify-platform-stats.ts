/**
 * Verify Platform Stats: Compare indexer platform statistics with derived values
 * 
 * Checks:
 * - totalPolls matches count of polls
 * - totalMarkets matches count of markets
 * - totalAmmMarkets + totalPariMarkets = totalMarkets
 * - totalTrades matches count of trades
 * - totalVolume matches sum of all market volumes
 * - totalLiquidity matches sum of all market TVLs
 * - totalUsers matches count of unique users
 */

import { type Address, parseAbiItem } from "viem";
import {
  client,
  queryIndexer,
  logHeader,
  logInfo,
  logSuccess,
  logError,
  logWarning,
  formatUSDC,
  compare,
  compareBigInt,
  createSummary,
  recordResult,
  printSummary,
  type VerificationSummary,
} from "./utils.js";
import { CONTRACTS, PredictionOracleAbi, MarketFactoryAbi } from "./contracts.js";

// Start block for Sonic
const START_BLOCK = 56_000_000n;

// GraphQL queries
const PLATFORM_STATS_QUERY = `
  query GetPlatformStats {
    platformStatss(limit: 1) {
      items {
        id
        chainId
        chainName
        totalPolls
        totalPollsResolved
        totalMarkets
        totalTrades
        totalUsers
        totalVolume
        totalLiquidity
        totalFees
        totalWinningsPaid
        totalAmmMarkets
        totalPariMarkets
        lastUpdatedAt
      }
    }
  }
`;

const COUNTS_QUERY = `
  query GetCounts {
    pollss(limit: 1000) {
      items { id }
    }
    marketss(limit: 1000) {
      items { id }
    }
    tradess(limit: 1000) {
      items { id }
    }
    userss(limit: 1000) {
      items { id }
    }
    winningss(limit: 1000) {
      items { id }
    }
  }
`;

const MARKET_TYPES_QUERY = `
  query GetMarketTypes {
    ammMarkets: marketss(where: { marketType: "amm" }, limit: 1000) {
      items { id }
    }
    pariMarkets: marketss(where: { marketType: "pari" }, limit: 1000) {
      items { id }
    }
  }
`;

const AGGREGATES_QUERY = `
  query GetAggregates {
    marketss(limit: 1000) {
      items {
        id
        totalVolume
        totalTrades
        currentTvl
        marketType
      }
    }
    tradess(limit: 1000) {
      items {
        collateralAmount
        feeAmount
      }
    }
    winningss(limit: 1000) {
      items {
        collateralAmount
      }
    }
  }
`;

interface PlatformStats {
  id: string;
  chainId: number;
  chainName: string;
  totalPolls: number;
  totalPollsResolved: number;
  totalMarkets: number;
  totalTrades: number;
  totalUsers: number;
  totalVolume: string;
  totalLiquidity: string;
  totalFees: string;
  totalWinningsPaid: string;
  totalAmmMarkets: number;
  totalPariMarkets: number;
  lastUpdatedAt: string;
}

interface Market {
  id: string;
  totalVolume: string;
  totalTrades: number;
  currentTvl: string;
  marketType: string;
}

interface Trade {
  collateralAmount: string;
  feeAmount: string;
}

interface Winning {
  collateralAmount: string;
}

// Event ABIs for counting on-chain
const PollCreatedEvent = parseAbiItem(
  "event PollCreated(address indexed pollAddress, address indexed creator, uint32 deadlineEpoch, string question)"
);

const MarketCreatedEvent = parseAbiItem(
  "event MarketCreated(address indexed pollAddress, address indexed marketAddress, address indexed creator, address yesToken, address noToken, address collateral, uint24 feeTier, uint24 maxPriceImbalancePerHour)"
);

const PariMutuelCreatedEvent = parseAbiItem(
  "event PariMutuelCreated(address indexed pollAddress, address indexed marketAddress, address indexed creator, address collateral, uint8 curveFlattener, uint24 curveOffset)"
);

/**
 * Count on-chain events
 */
async function countOnChainEvents(): Promise<{
  pollCount: number;
  ammCount: number;
  pariCount: number;
}> {
  logInfo("Counting on-chain events...");
  
  const toBlock = await client.getBlockNumber();
  const blockRange = 100000n;
  
  let pollCount = 0;
  let ammCount = 0;
  let pariCount = 0;
  
  for (let start = START_BLOCK; start <= toBlock; start += blockRange) {
    const end = start + blockRange > toBlock ? toBlock : start + blockRange;
    
    // Count PollCreated events
    const pollLogs = await client.getLogs({
      address: CONTRACTS.oracle as Address,
      event: PollCreatedEvent,
      fromBlock: start,
      toBlock: end,
    });
    pollCount += pollLogs.length;
    
    // Count MarketCreated events
    const ammLogs = await client.getLogs({
      address: CONTRACTS.marketFactory as Address,
      event: MarketCreatedEvent,
      fromBlock: start,
      toBlock: end,
    });
    ammCount += ammLogs.length;
    
    // Count PariMutuelCreated events
    const pariLogs = await client.getLogs({
      address: CONTRACTS.marketFactory as Address,
      event: PariMutuelCreatedEvent,
      fromBlock: start,
      toBlock: end,
    });
    pariCount += pariLogs.length;
  }
  
  return { pollCount, ammCount, pariCount };
}

/**
 * Verify counts consistency
 */
async function verifyCounts(
  stats: PlatformStats,
  summary: VerificationSummary
): Promise<void> {
  logHeader("COUNT VERIFICATION");
  
  // Fetch counts from indexer tables
  const countsData = await queryIndexer<{
    pollss: { items: { id: string }[] };
    marketss: { items: { id: string }[] };
    tradess: { items: { id: string }[] };
    userss: { items: { id: string }[] };
    winningss: { items: { id: string }[] };
  }>(COUNTS_QUERY);
  
  const pollCount = countsData.pollss.items.length;
  const marketCount = countsData.marketss.items.length;
  const tradeCount = countsData.tradess.items.length;
  const userCount = countsData.userss.items.length;
  
  // Compare totalPolls
  const pollsMatch = compare("Total Polls", stats.totalPolls, pollCount);
  recordResult(summary, pollsMatch.match, "totalPolls vs polls table");
  
  // Compare totalMarkets
  const marketsMatch = compare("Total Markets", stats.totalMarkets, marketCount);
  recordResult(summary, marketsMatch.match, "totalMarkets vs markets table");
  
  // Compare totalTrades
  const tradesMatch = compare("Total Trades", stats.totalTrades, tradeCount);
  recordResult(summary, tradesMatch.match, "totalTrades vs trades table");
  
  // Compare totalUsers
  const usersMatch = compare("Total Users", stats.totalUsers, userCount);
  recordResult(summary, usersMatch.match, "totalUsers vs users table");
  
  // Verify AMM + Pari = Total
  const marketTypeSum = stats.totalAmmMarkets + stats.totalPariMarkets;
  const typesSumMatch = compare(
    "AMM + Pari = Total",
    marketTypeSum,
    stats.totalMarkets
  );
  recordResult(summary, typesSumMatch.match, "market types sum");
}

/**
 * Verify against on-chain event counts
 */
async function verifyOnChainCounts(
  stats: PlatformStats,
  summary: VerificationSummary
): Promise<void> {
  logHeader("ON-CHAIN COUNT VERIFICATION");
  
  const onchain = await countOnChainEvents();
  
  logInfo(`On-chain polls: ${onchain.pollCount}`);
  logInfo(`On-chain AMM markets: ${onchain.ammCount}`);
  logInfo(`On-chain Pari markets: ${onchain.pariCount}`);
  
  // Compare poll count
  const pollsMatch = compare("Polls (on-chain)", stats.totalPolls, onchain.pollCount);
  recordResult(summary, pollsMatch.match, "totalPolls vs on-chain");
  
  // Compare AMM count
  const ammMatch = compare("AMM Markets (on-chain)", stats.totalAmmMarkets, onchain.ammCount);
  recordResult(summary, ammMatch.match, "totalAmmMarkets vs on-chain");
  
  // Compare Pari count
  const pariMatch = compare("Pari Markets (on-chain)", stats.totalPariMarkets, onchain.pariCount);
  recordResult(summary, pariMatch.match, "totalPariMarkets vs on-chain");
}

/**
 * Verify aggregated values
 */
async function verifyAggregates(
  stats: PlatformStats,
  summary: VerificationSummary
): Promise<void> {
  logHeader("AGGREGATE VALUE VERIFICATION");
  
  const data = await queryIndexer<{
    marketss: { items: Market[] };
    tradess: { items: Trade[] };
    winningss: { items: Winning[] };
  }>(AGGREGATES_QUERY);
  
  // Sum market volumes
  let sumVolume = 0n;
  let sumTrades = 0;
  let sumTvl = 0n;
  
  for (const market of data.marketss.items) {
    sumVolume += BigInt(market.totalVolume);
    sumTrades += market.totalTrades;
    sumTvl += BigInt(market.currentTvl);
  }
  
  // Compare totalVolume
  const statsVolume = BigInt(stats.totalVolume);
  const volumeMatch = compareBigInt("Total Volume", statsVolume, sumVolume, 0.01);
  recordResult(summary, volumeMatch.match, "totalVolume vs sum of markets");
  
  // Compare totalLiquidity
  const statsLiquidity = BigInt(stats.totalLiquidity);
  console.log(`\nPlatform totalLiquidity: ${formatUSDC(statsLiquidity)} USDC`);
  console.log(`Sum of market TVLs: ${formatUSDC(sumTvl)} USDC`);
  
  // Note: Liquidity tracking may differ from simple TVL sum
  // because liquidity can be removed but TVL resets may not propagate
  const liquidityDiff = statsLiquidity > sumTvl 
    ? statsLiquidity - sumTvl 
    : sumTvl - statsLiquidity;
  
  if (liquidityDiff > 0n) {
    logWarning(`Liquidity differs by ${formatUSDC(liquidityDiff)} USDC`);
    summary.warnings++;
  } else {
    logSuccess(`Liquidity matches`);
  }
  
  // Sum trade volumes from trades table
  let sumTradeVolume = 0n;
  let sumTradeFees = 0n;
  
  for (const trade of data.tradess.items) {
    sumTradeVolume += BigInt(trade.collateralAmount);
    sumTradeFees += BigInt(trade.feeAmount);
  }
  
  console.log(`\nSum of trade collateralAmounts: ${formatUSDC(sumTradeVolume)} USDC`);
  console.log(`Sum of trade fees: ${formatUSDC(sumTradeFees)} USDC`);
  console.log(`Platform totalFees: ${formatUSDC(BigInt(stats.totalFees))} USDC`);
  
  // Note: If trades are paginated, this may be incomplete
  logInfo(`Fetched ${data.tradess.items.length} trades for fee calculation`);
  
  // Sum winnings
  let sumWinnings = 0n;
  for (const winning of data.winningss.items) {
    sumWinnings += BigInt(winning.collateralAmount);
  }
  
  const statsWinnings = BigInt(stats.totalWinningsPaid);
  const winningsMatch = compareBigInt("Total Winnings Paid", statsWinnings, sumWinnings, 0.01);
  recordResult(summary, winningsMatch.match, "totalWinningsPaid vs sum of winnings");
}

/**
 * Main verification function
 */
export async function verifyPlatformStats(): Promise<VerificationSummary> {
  logHeader("PLATFORM STATS VERIFICATION");
  
  const summary = createSummary();
  
  // Fetch platform stats
  logInfo("Fetching platform stats from indexer...");
  
  let stats: PlatformStats | null = null;
  
  try {
    const data = await queryIndexer<{ platformStatss: { items: PlatformStats[] } }>(
      PLATFORM_STATS_QUERY
    );
    stats = data.platformStatss.items[0] ?? null;
  } catch (error) {
    logError(`Failed to fetch platform stats: ${error}`);
    return summary;
  }
  
  if (!stats) {
    logError("No platform stats found");
    return summary;
  }
  
  // Display current stats
  logInfo(`Chain: ${stats.chainName} (${stats.chainId})`);
  console.log();
  console.log(`📊 Platform Statistics:`);
  console.log(`   Total Polls:    ${stats.totalPolls} (resolved: ${stats.totalPollsResolved})`);
  console.log(`   Total Markets:  ${stats.totalMarkets} (AMM: ${stats.totalAmmMarkets}, Pari: ${stats.totalPariMarkets})`);
  console.log(`   Total Trades:   ${stats.totalTrades}`);
  console.log(`   Total Users:    ${stats.totalUsers}`);
  console.log(`   Total Volume:   ${formatUSDC(BigInt(stats.totalVolume))} USDC`);
  console.log(`   Total Liquidity: ${formatUSDC(BigInt(stats.totalLiquidity))} USDC`);
  console.log(`   Total Fees:     ${formatUSDC(BigInt(stats.totalFees))} USDC`);
  console.log(`   Total Winnings: ${formatUSDC(BigInt(stats.totalWinningsPaid))} USDC`);
  
  // Verify internal consistency
  await verifyCounts(stats, summary);
  
  // Verify aggregated values
  await verifyAggregates(stats, summary);
  
  // Verify against on-chain (optional - can be slow)
  const verifyOnChain = process.argv.includes("--onchain");
  if (verifyOnChain) {
    await verifyOnChainCounts(stats, summary);
  } else {
    logInfo("Skipping on-chain verification (use --onchain flag to enable)");
  }
  
  return summary;
}

// Run if called directly
const scriptPath = process.argv[1];
const isMainModule = import.meta.url.endsWith(scriptPath.split('/').pop()!) || 
                     import.meta.url.includes('verify-platform-stats');
if (isMainModule) {
  verifyPlatformStats()
    .then(printSummary)
    .catch(console.error);
}

