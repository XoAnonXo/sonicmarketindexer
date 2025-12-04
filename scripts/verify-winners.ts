#!/usr/bin/env tsx
/**
 * Verify Winners: Compare indexer winnings data with on-chain events
 * 
 * Checks:
 * 1. Trading profit (buy low, sell high)
 * 2. WinningsRedeemed claims (AMM + PariMutuel)
 */

import { createPublicClient, http, formatUnits, parseAbiItem, type Address } from "viem";
import { sonic } from "viem/chains";
import { CONTRACTS, RPC_URL, USDC_DECIMALS } from "./contracts.js";
import { queryIndexer } from "./utils.js";

// Create client
const client = createPublicClient({
  chain: sonic,
  transport: http(RPC_URL),
});

// Colors
const colors = {
  reset: "\x1b[0m",
  bright: "\x1b[1m",
  red: "\x1b[31m",
  green: "\x1b[32m",
  yellow: "\x1b[33m",
  cyan: "\x1b[36m",
};

function log(msg: string, color?: string) {
  console.log(color ? `${color}${msg}${colors.reset}` : msg);
}

function formatUSDC(amount: bigint): string {
  return formatUnits(amount, USDC_DECIMALS);
}

// GraphQL queries
const WINNINGS_QUERY = `
  query {
    winningss(limit: 1000, orderBy: "collateralAmount", orderDirection: "desc") {
      items {
        id
        user
        marketAddress
        collateralAmount
        feeAmount
        marketQuestion
        marketType
        outcome
        txHash
        timestamp
      }
    }
  }
`;

const USERS_QUERY = `
  query {
    userss(limit: 100, orderBy: "totalWinnings", orderDirection: "desc") {
      items {
        id
        address
        totalWinnings
        totalWins
        totalTrades
        totalVolume
        totalDeposited
        currentStreak
        bestStreak
      }
    }
  }
`;

const TRADES_QUERY = `
  query {
    tradess(limit: 500, orderBy: "collateralAmount", orderDirection: "desc") {
      items {
        id
        trader
        marketAddress
        tradeType
        side
        collateralAmount
        tokenAmount
        feeAmount
        timestamp
      }
    }
  }
`;

const MARKETS_QUERY = `
  query {
    marketss(limit: 100) {
      items {
        id
        marketType
        pollAddress
      }
    }
  }
`;

const PLATFORM_STATS_QUERY = `
  query {
    platformStatss(limit: 1) {
      items {
        totalWinningsPaid
      }
    }
  }
`;

interface Winning {
  id: string;
  user: string;
  marketAddress: string;
  collateralAmount: string;
  feeAmount: string;
  marketQuestion: string | null;
  marketType: string;
  outcome: number | null;
  txHash: string;
  timestamp: string;
}

interface User {
  id: string;
  address: string;
  totalWinnings: string;
  totalWins: number;
  totalTrades: number;
  totalVolume: string;
  totalDeposited: string;
  currentStreak: number;
  bestStreak: number;
}

interface Trade {
  id: string;
  trader: string;
  marketAddress: string;
  tradeType: string;
  side: string;
  collateralAmount: string;
  tokenAmount: string;
  feeAmount: string;
  timestamp: string;
}

interface Market {
  id: string;
  marketType: string;
  pollAddress: string;
}

// Event signatures
const AMM_WINNINGS_EVENT = parseAbiItem("event WinningsRedeemed(address indexed user, uint256 yesAmount, uint256 noAmount, uint256 collateralAmount)");
const PARI_WINNINGS_EVENT = parseAbiItem("event WinningsRedeemed(address indexed user, uint256 collateralAmount, uint8 outcome, uint256 fee)");

async function getOnChainWinnings(
  marketAddress: Address,
  marketType: "amm" | "pari"
): Promise<{ count: number; totalAmount: bigint; winners: Map<string, bigint> }> {
  const winners = new Map<string, bigint>();
  let totalAmount = 0n;
  
  try {
    const event = marketType === "amm" ? AMM_WINNINGS_EVENT : PARI_WINNINGS_EVENT;
    
    const logs = await client.getLogs({
      address: marketAddress,
      event,
      fromBlock: BigInt(CONTRACTS.startBlock),
      toBlock: "latest",
    });
    
    for (const log of logs) {
      const args = log.args as any;
      const user = args.user?.toLowerCase();
      const amount = args.collateralAmount ?? 0n;
      
      if (user && amount > 0n) {
        const existing = winners.get(user) ?? 0n;
        winners.set(user, existing + amount);
        totalAmount += amount;
      }
    }
    
    return { count: logs.length, totalAmount, winners };
  } catch (error) {
    return { count: 0, totalAmount: 0n, winners };
  }
}

async function main() {
  log("\n" + "=".repeat(70), colors.bright);
  log("  WINNERS VERIFICATION - Indexer vs On-Chain", colors.bright);
  log("=".repeat(70), colors.bright);
  
  log(`\nRPC: ${RPC_URL}`, colors.cyan);
  log(`Indexer: ${process.env.INDEXER_URL ?? "http://localhost:42069"}`, colors.cyan);

  // Fetch data from indexer
  log("\n📊 Fetching data from indexer...", colors.yellow);
  
  let winnings: Winning[];
  let users: User[];
  let trades: Trade[];
  let markets: Market[];
  let platformWinningsPaid: bigint;
  
  try {
    const [winningsData, usersData, tradesData, marketsData, statsData] = await Promise.all([
      queryIndexer<{ winningss: { items: Winning[] } }>(WINNINGS_QUERY),
      queryIndexer<{ userss: { items: User[] } }>(USERS_QUERY),
      queryIndexer<{ tradess: { items: Trade[] } }>(TRADES_QUERY),
      queryIndexer<{ marketss: { items: Market[] } }>(MARKETS_QUERY),
      queryIndexer<{ platformStatss: { items: { totalWinningsPaid: string }[] } }>(PLATFORM_STATS_QUERY),
    ]);
    
    winnings = winningsData.winningss.items;
    users = usersData.userss.items;
    trades = tradesData.tradess.items;
    markets = marketsData.marketss.items;
    platformWinningsPaid = BigInt(statsData.platformStatss.items[0]?.totalWinningsPaid ?? "0");
  } catch (error) {
    log(`❌ Failed to fetch from indexer: ${error}`, colors.red);
    return;
  }
  
  log(`✅ Fetched ${winnings.length} winning claims, ${users.length} users, ${trades.length} trades`, colors.green);

  // Create market type lookup
  const marketTypeLookup = new Map<string, string>();
  for (const market of markets) {
    marketTypeLookup.set(market.id.toLowerCase(), market.marketType);
  }

  // ==========================================================================
  // SECTION 1: Biggest Win Claims (WinningsRedeemed)
  // ==========================================================================
  
  log("\n" + "=".repeat(70), colors.bright);
  log("  BIGGEST WIN CLAIMS (WinningsRedeemed)", colors.bright);
  log("=".repeat(70), colors.bright);

  // Group winnings by user
  const userWinnings = new Map<string, bigint>();
  for (const w of winnings) {
    const user = w.user.toLowerCase();
    const amount = BigInt(w.collateralAmount);
    const existing = userWinnings.get(user) ?? 0n;
    userWinnings.set(user, existing + amount);
  }

  // Sort by total winnings
  const sortedWinners = [...userWinnings.entries()]
    .sort((a, b) => Number(b[1] - a[1]))
    .slice(0, 10);

  log("\n🏆 Top 10 Winners (by total claimed winnings):", colors.cyan);
  console.log("-".repeat(60));
  
  let rank = 1;
  for (const [user, amount] of sortedWinners) {
    const claims = winnings.filter(w => w.user.toLowerCase() === user).length;
    const userData = users.find(u => u.address.toLowerCase() === user);
    const indexerWinnings = userData ? BigInt(userData.totalWinnings) : 0n;
    
    const match = indexerWinnings === amount ? "✅" : "⚠️";
    
    console.log(`${match} #${rank}. ${user.slice(0, 10)}...${user.slice(-6)}`);
    console.log(`      Winnings:  ${formatUSDC(amount)} USDC (${claims} claims)`);
    if (indexerWinnings !== amount) {
      console.log(`      (User record shows: ${formatUSDC(indexerWinnings)} USDC)`);
    }
    console.log();
    rank++;
  }

  // Biggest single claims
  log("\n💰 Top 10 Single Biggest Claims:", colors.cyan);
  console.log("-".repeat(60));
  
  const topClaims = winnings.slice(0, 10);
  for (let i = 0; i < topClaims.length; i++) {
    const w = topClaims[i];
    const amount = formatUSDC(BigInt(w.collateralAmount));
    const type = w.marketType.toUpperCase();
    const question = w.marketQuestion?.slice(0, 35) ?? "Unknown";
    
    console.log(`#${i + 1}. ${amount} USDC [${type}]`);
    console.log(`    User: ${w.user.slice(0, 10)}...${w.user.slice(-6)}`);
    console.log(`    Market: ${question}...`);
    console.log();
  }

  // ==========================================================================
  // SECTION 2: Trading Profit (Buy/Sell difference)
  // ==========================================================================
  
  log("\n" + "=".repeat(70), colors.bright);
  log("  TRADING PROFIT ANALYSIS", colors.bright);
  log("=".repeat(70), colors.bright);

  // Calculate profit per trader
  // Profit = (Sell collateral - fees) - (Buy collateral + fees)
  const traderStats = new Map<string, {
    buyVolume: bigint;
    sellVolume: bigint;
    fees: bigint;
    buyCount: number;
    sellCount: number;
  }>();

  for (const trade of trades) {
    const trader = trade.trader.toLowerCase();
    const amount = BigInt(trade.collateralAmount);
    const fee = BigInt(trade.feeAmount);
    
    const stats = traderStats.get(trader) ?? {
      buyVolume: 0n,
      sellVolume: 0n,
      fees: 0n,
      buyCount: 0,
      sellCount: 0,
    };
    
    if (trade.tradeType === "buy") {
      stats.buyVolume += amount;
      stats.buyCount++;
    } else if (trade.tradeType === "sell") {
      stats.sellVolume += amount;
      stats.sellCount++;
    }
    stats.fees += fee;
    
    traderStats.set(trader, stats);
  }

  // Calculate realized profit (only for traders who have sold)
  const profitLeaders: Array<{ trader: string; profit: bigint; stats: typeof traderStats extends Map<string, infer V> ? V : never }> = [];
  
  for (const [trader, stats] of traderStats) {
    if (stats.sellCount > 0) {
      // Realized profit = sell proceeds - buy cost - fees
      const profit = stats.sellVolume - stats.buyVolume - stats.fees;
      profitLeaders.push({ trader, profit, stats });
    }
  }

  // Sort by profit
  profitLeaders.sort((a, b) => Number(b.profit - a.profit));

  log("\n📈 Top Traders by Realized Profit (Sells - Buys - Fees):", colors.cyan);
  console.log("-".repeat(60));
  
  if (profitLeaders.length === 0) {
    log("   No traders have sold yet (no realized profits)", colors.yellow);
  } else {
    for (let i = 0; i < Math.min(10, profitLeaders.length); i++) {
      const { trader, profit, stats } = profitLeaders[i];
      const profitStr = formatUSDC(profit);
      const isProfit = profit > 0n;
      const emoji = isProfit ? "🟢" : "🔴";
      const sign = isProfit ? "+" : "";
      
      console.log(`${emoji} #${i + 1}. ${trader.slice(0, 10)}...${trader.slice(-6)}`);
      console.log(`      Profit: ${sign}${profitStr} USDC`);
      console.log(`      Buys: ${stats.buyCount} (${formatUSDC(stats.buyVolume)} USDC)`);
      console.log(`      Sells: ${stats.sellCount} (${formatUSDC(stats.sellVolume)} USDC)`);
      console.log(`      Fees: ${formatUSDC(stats.fees)} USDC`);
      console.log();
    }
  }

  // ==========================================================================
  // SECTION 3: On-Chain Verification
  // ==========================================================================
  
  log("\n" + "=".repeat(70), colors.bright);
  log("  ON-CHAIN WINNINGS VERIFICATION", colors.bright);
  log("=".repeat(70), colors.bright);

  let totalOnChainWinnings = 0n;
  let totalIndexerWinnings = 0n;
  let marketsMismatched = 0;
  let marketsMatched = 0;
  
  // Group indexed winnings by market
  const indexerWinningsByMarket = new Map<string, bigint>();
  for (const w of winnings) {
    const market = w.marketAddress.toLowerCase();
    const existing = indexerWinningsByMarket.get(market) ?? 0n;
    indexerWinningsByMarket.set(market, existing + BigInt(w.collateralAmount));
  }

  log("\n📊 Checking winnings per market...", colors.yellow);
  
  const ammMarkets = markets.filter(m => m.marketType === "amm");
  const pariMarkets = markets.filter(m => m.marketType === "pari");
  
  for (const market of [...ammMarkets, ...pariMarkets]) {
    const marketAddress = market.id as Address;
    const marketType = market.marketType as "amm" | "pari";
    
    const onchainResult = await getOnChainWinnings(marketAddress, marketType);
    const indexerAmount = indexerWinningsByMarket.get(marketAddress.toLowerCase()) ?? 0n;
    
    totalOnChainWinnings += onchainResult.totalAmount;
    totalIndexerWinnings += indexerAmount;
    
    const match = indexerAmount === onchainResult.totalAmount;
    if (match) {
      marketsMatched++;
    } else {
      marketsMismatched++;
      const diff = indexerAmount - onchainResult.totalAmount;
      const sign = diff > 0n ? "+" : "";
      log(`❌ [${marketType.toUpperCase()}] ${marketAddress.slice(0, 10)}...`, colors.red);
      console.log(`      Indexer:  ${formatUSDC(indexerAmount)} USDC (${winnings.filter(w => w.marketAddress.toLowerCase() === marketAddress.toLowerCase()).length} claims)`);
      console.log(`      On-chain: ${formatUSDC(onchainResult.totalAmount)} USDC (${onchainResult.count} events)`);
      console.log(`      Diff: ${sign}${formatUSDC(diff > 0n ? diff : -diff)} USDC`);
    }
  }

  // ==========================================================================
  // SUMMARY
  // ==========================================================================
  
  log("\n" + "=".repeat(70), colors.bright);
  log("  SUMMARY", colors.bright);
  log("=".repeat(70), colors.bright);
  
  console.log(`\n📊 Winnings Verification:`);
  log(`   ✅ Markets matched:    ${marketsMatched}`, colors.green);
  if (marketsMismatched > 0) {
    log(`   ❌ Markets mismatched: ${marketsMismatched}`, colors.red);
  }
  
  console.log(`\n💰 Total Winnings:`);
  console.log(`   Platform totalWinningsPaid:  ${formatUSDC(platformWinningsPaid)} USDC`);
  console.log(`   Sum from winnings table:     ${formatUSDC(totalIndexerWinnings)} USDC`);
  console.log(`   On-chain events total:       ${formatUSDC(totalOnChainWinnings)} USDC`);
  
  const indexerMatch = platformWinningsPaid === totalIndexerWinnings;
  const onchainMatch = totalIndexerWinnings === totalOnChainWinnings;
  
  if (indexerMatch && onchainMatch) {
    log(`\n✅ All winnings data matches!`, colors.green);
  } else {
    if (!indexerMatch) {
      log(`\n⚠️  Platform stats don't match sum of winnings table`, colors.yellow);
    }
    if (!onchainMatch) {
      const diff = totalIndexerWinnings - totalOnChainWinnings;
      const sign = diff > 0n ? "+" : "-";
      log(`\n⚠️  Indexer vs On-chain difference: ${sign}${formatUSDC(diff > 0n ? diff : -diff)} USDC`, colors.yellow);
    }
  }
  
  console.log(`\n🏆 Key Stats:`);
  console.log(`   Total winning claims:        ${winnings.length}`);
  console.log(`   Unique winners:              ${userWinnings.size}`);
  console.log(`   Biggest single claim:        ${winnings[0] ? formatUSDC(BigInt(winnings[0].collateralAmount)) : "0"} USDC`);
  console.log(`   Top winner total:            ${sortedWinners[0] ? formatUSDC(sortedWinners[0][1]) : "0"} USDC`);
  
  console.log(`\n📈 Trading Stats:`);
  console.log(`   Traders with sells:          ${profitLeaders.length}`);
  if (profitLeaders.length > 0) {
    const topProfit = profitLeaders[0];
    const sign = topProfit.profit > 0n ? "+" : "";
    console.log(`   Top trader profit:           ${sign}${formatUSDC(topProfit.profit)} USDC`);
  }
  
  console.log();
}

main().catch(console.error);




