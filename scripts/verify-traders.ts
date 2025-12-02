#!/usr/bin/env tsx
/**
 * Verify Unique Traders: Compare indexer user counts with on-chain events
 * 
 * Checks:
 * - Total unique traders matches on-chain unique addresses
 * - Per-market unique trader counts
 * - Trader addresses are correctly indexed
 */

import { createPublicClient, http, parseAbiItem, type Address } from "viem";
import { sonic } from "viem/chains";
import { CONTRACTS, RPC_URL } from "./contracts.js";
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

// GraphQL queries
const USERS_QUERY = `
  query {
    userss(limit: 1000) {
      items {
        id
        address
        totalTrades
        totalVolume
        firstTradeAt
      }
    }
  }
`;

const TRADES_QUERY = `
  query {
    tradess(limit: 500) {
      items {
        id
        trader
        marketAddress
      }
    }
  }
`;

const MARKETS_QUERY = `
  query {
    marketss(limit: 1000) {
      items {
        id
        marketType
        uniqueTraders
      }
    }
  }
`;

const PLATFORM_STATS_QUERY = `
  query {
    platformStatss(limit: 1) {
      items {
        totalUsers
      }
    }
  }
`;

interface User {
  id: string;
  address: string;
  totalTrades: number;
  totalVolume: string;
  firstTradeAt: string;
}

interface Trade {
  trader: string;
  marketAddress: string;
}

interface Market {
  id: string;
  marketType: string;
  uniqueTraders: number;
}

// Event signatures
const BUY_TOKENS_EVENT = parseAbiItem("event BuyTokens(address indexed trader, bool indexed isYes, uint256 tokenAmount, uint256 collateralAmount, uint256 fee)");
const SELL_TOKENS_EVENT = parseAbiItem("event SellTokens(address indexed trader, bool indexed isYes, uint256 tokenAmount, uint256 collateralAmount, uint256 fee)");
const POSITION_PURCHASED_EVENT = parseAbiItem("event PositionPurchased(address indexed buyer, bool indexed isYes, uint256 collateralIn, uint256 sharesOut)");

async function getOnChainTraders(
  marketAddress: Address,
  marketType: "amm" | "pari"
): Promise<Set<string>> {
  const traders = new Set<string>();
  const fromBlock = BigInt(CONTRACTS.startBlock);
  
  try {
    if (marketType === "amm") {
      // Get BuyTokens traders
      const buyLogs = await client.getLogs({
        address: marketAddress,
        event: BUY_TOKENS_EVENT,
        fromBlock,
        toBlock: "latest",
      });
      
      for (const log of buyLogs) {
        if (log.args.trader) {
          traders.add(log.args.trader.toLowerCase());
        }
      }
      
      // Get SellTokens traders
      const sellLogs = await client.getLogs({
        address: marketAddress,
        event: SELL_TOKENS_EVENT,
        fromBlock,
        toBlock: "latest",
      });
      
      for (const log of sellLogs) {
        if (log.args.trader) {
          traders.add(log.args.trader.toLowerCase());
        }
      }
    } else {
      // Get PositionPurchased buyers
      const posLogs = await client.getLogs({
        address: marketAddress,
        event: POSITION_PURCHASED_EVENT,
        fromBlock,
        toBlock: "latest",
      });
      
      for (const log of posLogs) {
        if (log.args.buyer) {
          traders.add(log.args.buyer.toLowerCase());
        }
      }
    }
  } catch (error) {
    console.error(`Error fetching traders for ${marketAddress}:`, error);
  }
  
  return traders;
}

async function main() {
  log("\n" + "=".repeat(70), colors.bright);
  log("  UNIQUE TRADERS VERIFICATION - Indexer vs On-Chain", colors.bright);
  log("=".repeat(70), colors.bright);
  
  log(`\nRPC: ${RPC_URL}`, colors.cyan);
  log(`Indexer: ${process.env.INDEXER_URL ?? "http://localhost:42069"}`, colors.cyan);

  // Fetch data from indexer
  log("\n📊 Fetching data from indexer...", colors.yellow);
  
  let users: User[];
  let trades: Trade[];
  let markets: Market[];
  let platformTotalUsers: number;
  
  try {
    const [usersData, tradesData, marketsData, statsData] = await Promise.all([
      queryIndexer<{ userss: { items: User[] } }>(USERS_QUERY),
      queryIndexer<{ tradess: { items: Trade[] } }>(TRADES_QUERY),
      queryIndexer<{ marketss: { items: Market[] } }>(MARKETS_QUERY),
      queryIndexer<{ platformStatss: { items: { totalUsers: number }[] } }>(PLATFORM_STATS_QUERY),
    ]);
    
    users = usersData.userss.items;
    trades = tradesData.tradess.items;
    markets = marketsData.marketss.items;
    platformTotalUsers = statsData.platformStatss.items[0]?.totalUsers ?? 0;
  } catch (error) {
    log(`❌ Failed to fetch from indexer: ${error}`, colors.red);
    return;
  }
  
  log(`✅ Fetched ${users.length} users from indexer`, colors.green);
  log(`   Platform totalUsers: ${platformTotalUsers}`, colors.cyan);
  log(`   Trades to analyze: ${trades.length}`, colors.cyan);

  // Calculate unique traders from trades
  const tradersFromTrades = new Set<string>();
  const tradersByMarket: Map<string, Set<string>> = new Map();
  
  for (const trade of trades) {
    const trader = trade.trader.toLowerCase();
    tradersFromTrades.add(trader);
    
    const marketTraders = tradersByMarket.get(trade.marketAddress) ?? new Set();
    marketTraders.add(trader);
    tradersByMarket.set(trade.marketAddress, marketTraders);
  }

  // Get unique traders from users table
  const tradersFromUsers = new Set(users.map(u => u.address.toLowerCase()));

  log("\n" + "=".repeat(70), colors.bright);
  log("  GLOBAL UNIQUE TRADERS", colors.bright);
  log("=".repeat(70), colors.bright);
  
  console.log(`\n📊 Indexer Data:`);
  console.log(`   Users table count:         ${users.length}`);
  console.log(`   Platform totalUsers:       ${platformTotalUsers}`);
  console.log(`   Unique traders from trades: ${tradersFromTrades.size}`);

  // Compare users table with trades
  const inUsersNotInTrades = [...tradersFromUsers].filter(t => !tradersFromTrades.has(t));
  const inTradesNotInUsers = [...tradersFromTrades].filter(t => !tradersFromUsers.has(t));
  
  if (inUsersNotInTrades.length > 0) {
    log(`\n⚠️  ${inUsersNotInTrades.length} users in table but not in trades:`, colors.yellow);
    for (const addr of inUsersNotInTrades.slice(0, 5)) {
      console.log(`      ${addr}`);
    }
    if (inUsersNotInTrades.length > 5) {
      console.log(`      ... and ${inUsersNotInTrades.length - 5} more`);
    }
  }
  
  if (inTradesNotInUsers.length > 0) {
    log(`\n❌ ${inTradesNotInUsers.length} traders in trades but NOT in users table:`, colors.red);
    for (const addr of inTradesNotInUsers.slice(0, 5)) {
      console.log(`      ${addr}`);
    }
  }

  // Now verify against on-chain
  log("\n" + "=".repeat(70), colors.bright);
  log("  PER-MARKET VERIFICATION", colors.bright);
  log("=".repeat(70), colors.bright);
  
  const allOnchainTraders = new Set<string>();
  let matchedMarkets = 0;
  let mismatchedMarkets = 0;
  
  const ammMarkets = markets.filter(m => m.marketType === "amm");
  const pariMarkets = markets.filter(m => m.marketType === "pari");
  
  log(`\n📈 Checking ${ammMarkets.length} AMM markets...`, colors.yellow);
  
  for (const market of ammMarkets) {
    const marketAddress = market.id as Address;
    const indexerTraders = tradersByMarket.get(marketAddress)?.size ?? 0;
    const indexerUniqueTraders = market.uniqueTraders;
    
    const onchainTraders = await getOnChainTraders(marketAddress, "amm");
    onchainTraders.forEach(t => allOnchainTraders.add(t));
    
    const match = indexerTraders === onchainTraders.size;
    
    if (match) {
      matchedMarkets++;
      console.log(`✅ [AMM] ${marketAddress}`);
      console.log(`      Unique traders: ${indexerTraders}`);
    } else {
      mismatchedMarkets++;
      log(`❌ [AMM] ${marketAddress}`, colors.red);
      console.log(`      Indexer (trades):    ${indexerTraders}`);
      console.log(`      Indexer (field):     ${indexerUniqueTraders}`);
      console.log(`      On-chain:            ${onchainTraders.size}`);
      console.log(`      Diff: ${indexerTraders - onchainTraders.size}`);
    }
  }
  
  log(`\n📊 Checking ${pariMarkets.length} PariMutuel markets...`, colors.yellow);
  
  for (const market of pariMarkets) {
    const marketAddress = market.id as Address;
    const indexerTraders = tradersByMarket.get(marketAddress)?.size ?? 0;
    const indexerUniqueTraders = market.uniqueTraders;
    
    const onchainTraders = await getOnChainTraders(marketAddress, "pari");
    onchainTraders.forEach(t => allOnchainTraders.add(t));
    
    const match = indexerTraders === onchainTraders.size;
    
    if (match) {
      matchedMarkets++;
      console.log(`✅ [PARI] ${marketAddress}`);
      console.log(`      Unique traders: ${indexerTraders}`);
    } else {
      mismatchedMarkets++;
      log(`❌ [PARI] ${marketAddress}`, colors.red);
      console.log(`      Indexer (trades):    ${indexerTraders}`);
      console.log(`      Indexer (field):     ${indexerUniqueTraders}`);
      console.log(`      On-chain:            ${onchainTraders.size}`);
      console.log(`      Diff: ${indexerTraders - onchainTraders.size}`);
    }
  }

  // Summary
  log("\n" + "=".repeat(70), colors.bright);
  log("  SUMMARY", colors.bright);
  log("=".repeat(70), colors.bright);
  
  console.log(`\n📊 Market Verification:`);
  log(`   ✅ Matched:    ${matchedMarkets}`, colors.green);
  if (mismatchedMarkets > 0) {
    log(`   ❌ Mismatched: ${mismatchedMarkets}`, colors.red);
  }
  
  console.log(`\n👥 Global Unique Traders:`);
  console.log(`   Indexer users table:    ${users.length}`);
  console.log(`   Platform totalUsers:    ${platformTotalUsers}`);
  console.log(`   From indexed trades:    ${tradersFromTrades.size}`);
  console.log(`   From on-chain events:   ${allOnchainTraders.size}`);
  
  const globalMatch = tradersFromTrades.size === allOnchainTraders.size;
  if (globalMatch) {
    log(`\n✅ Global unique trader count MATCHES!`, colors.green);
  } else {
    const diff = tradersFromTrades.size - allOnchainTraders.size;
    const sign = diff > 0 ? "+" : "";
    log(`\n⚠️  Global trader count differs: ${sign}${diff}`, colors.yellow);
    
    // Find differences
    const inIndexerNotOnchain = [...tradersFromTrades].filter(t => !allOnchainTraders.has(t));
    const onchainNotInIndexer = [...allOnchainTraders].filter(t => !tradersFromTrades.has(t));
    
    if (inIndexerNotOnchain.length > 0) {
      log(`\n   In indexer but not on-chain: ${inIndexerNotOnchain.length}`, colors.yellow);
      for (const addr of inIndexerNotOnchain.slice(0, 3)) {
        console.log(`      ${addr}`);
      }
    }
    
    if (onchainNotInIndexer.length > 0) {
      log(`\n   On-chain but not in indexer: ${onchainNotInIndexer.length}`, colors.red);
      for (const addr of onchainNotInIndexer.slice(0, 3)) {
        console.log(`      ${addr}`);
      }
    }
  }
  
  // List top traders
  const traderTradeCounts = new Map<string, number>();
  for (const trade of trades) {
    const count = traderTradeCounts.get(trade.trader.toLowerCase()) ?? 0;
    traderTradeCounts.set(trade.trader.toLowerCase(), count + 1);
  }
  
  const topTraders = [...traderTradeCounts.entries()]
    .sort((a, b) => b[1] - a[1])
    .slice(0, 5);
  
  log(`\n🏆 Top 5 Traders by Trade Count:`, colors.cyan);
  for (const [addr, count] of topTraders) {
    console.log(`   ${addr.slice(0, 10)}...${addr.slice(-6)}: ${count} trades`);
  }
  
  console.log();
}

main().catch(console.error);

