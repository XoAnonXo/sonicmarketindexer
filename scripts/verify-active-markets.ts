#!/usr/bin/env tsx
/**
 * Verify Active Markets: Compare indexer market status with on-chain poll status
 * 
 * A market is "active" if its associated poll has status = 0 (pending)
 * Checks both AMM and PariMutuel markets
 */

import { createPublicClient, http, getContract, type Address } from "viem";
import { sonic } from "viem/chains";
import { CONTRACTS, PredictionPollAbi, RPC_URL } from "./contracts.js";
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
  dim: "\x1b[2m",
};

function log(msg: string, color?: string) {
  console.log(color ? `${color}${msg}${colors.reset}` : msg);
}

// Poll status enum
const POLL_STATUS = {
  0: "PENDING",
  1: "YES",
  2: "NO", 
  3: "UNKNOWN",
} as const;

// GraphQL queries
const MARKETS_QUERY = `
  query {
    marketss(limit: 1000) {
      items {
        id
        marketType
        pollAddress
        totalVolume
        totalTrades
        currentTvl
      }
    }
  }
`;

const POLLS_QUERY = `
  query {
    pollss(limit: 1000) {
      items {
        id
        question
        status
        deadlineEpoch
      }
    }
  }
`;

const PLATFORM_STATS_QUERY = `
  query {
    platformStatss(limit: 1) {
      items {
        totalMarkets
        totalAmmMarkets
        totalPariMarkets
      }
    }
  }
`;

interface Market {
  id: string;
  marketType: string;
  pollAddress: string;
  totalVolume: string;
  totalTrades: number;
  currentTvl: string;
}

interface Poll {
  id: string;
  question: string;
  status: number;
  deadlineEpoch: number;
}

// ABI for getStatus function (the actual function name on-chain)
const GetStatusAbi = [{
  type: "function",
  name: "getStatus",
  inputs: [],
  outputs: [{ name: "", type: "uint8" }],
  stateMutability: "view",
}] as const;

async function getOnChainPollStatus(pollAddress: Address): Promise<number | null> {
  try {
    const status = await client.readContract({
      address: pollAddress,
      abi: GetStatusAbi,
      functionName: "getStatus",
    });
    return Number(status);
  } catch (error) {
    return null;
  }
}

async function main() {
  log("\n" + "=".repeat(70), colors.bright);
  log("  ACTIVE MARKETS VERIFICATION - Indexer vs On-Chain", colors.bright);
  log("=".repeat(70), colors.bright);
  
  log(`\nRPC: ${RPC_URL}`, colors.cyan);
  log(`Indexer: ${process.env.INDEXER_URL ?? "http://localhost:42069"}`, colors.cyan);

  // Fetch data from indexer
  log("\n📊 Fetching data from indexer...", colors.yellow);
  
  let markets: Market[];
  let polls: Poll[];
  let platformStats: { totalMarkets: number; totalAmmMarkets: number; totalPariMarkets: number };
  
  try {
    const [marketsData, pollsData, statsData] = await Promise.all([
      queryIndexer<{ marketss: { items: Market[] } }>(MARKETS_QUERY),
      queryIndexer<{ pollss: { items: Poll[] } }>(POLLS_QUERY),
      queryIndexer<{ platformStatss: { items: typeof platformStats[] } }>(PLATFORM_STATS_QUERY),
    ]);
    
    markets = marketsData.marketss.items;
    polls = pollsData.pollss.items;
    platformStats = statsData.platformStatss.items[0] ?? { totalMarkets: 0, totalAmmMarkets: 0, totalPariMarkets: 0 };
  } catch (error) {
    log(`❌ Failed to fetch from indexer: ${error}`, colors.red);
    return;
  }
  
  log(`✅ Fetched ${markets.length} markets and ${polls.length} polls`, colors.green);

  // Create poll lookup
  const pollLookup = new Map<string, Poll>();
  for (const poll of polls) {
    pollLookup.set(poll.id.toLowerCase(), poll);
  }

  // Categorize markets
  const ammMarkets = markets.filter(m => m.marketType === "amm");
  const pariMarkets = markets.filter(m => m.marketType === "pari");
  
  log("\n" + "=".repeat(70), colors.bright);
  log("  MARKET STATUS CHECK", colors.bright);
  log("=".repeat(70), colors.bright);

  // Track active markets
  const activeAmm: Market[] = [];
  const activePari: Market[] = [];
  const resolvedAmm: Market[] = [];
  const resolvedPari: Market[] = [];
  const unknownStatus: Market[] = [];
  
  let matchedStatus = 0;
  let mismatchedStatus = 0;

  log(`\n📈 Checking ${ammMarkets.length} AMM markets...`, colors.yellow);
  
  for (const market of ammMarkets) {
    const pollAddress = market.pollAddress as Address;
    const indexerPoll = pollLookup.get(pollAddress?.toLowerCase());
    const indexerStatus = indexerPoll?.status;
    
    // Get on-chain status
    const onchainStatus = pollAddress ? await getOnChainPollStatus(pollAddress) : null;
    
    const statusMatch = indexerStatus === onchainStatus;
    if (statusMatch) matchedStatus++;
    else mismatchedStatus++;
    
    const isActive = onchainStatus === 0;
    if (isActive) {
      activeAmm.push(market);
    } else if (onchainStatus !== null) {
      resolvedAmm.push(market);
    } else {
      unknownStatus.push(market);
    }
    
    const statusLabel = onchainStatus !== null ? POLL_STATUS[onchainStatus as keyof typeof POLL_STATUS] : "UNKNOWN";
    const statusIcon = isActive ? "🟢" : (onchainStatus !== null ? "🔴" : "⚪");
    const matchIcon = statusMatch ? "✅" : "❌";
    
    console.log(`${matchIcon} ${statusIcon} [AMM] ${market.id.slice(0, 10)}...`);
    console.log(`      Poll: ${pollAddress?.slice(0, 10) ?? "N/A"}...`);
    console.log(`      Status: ${statusLabel} (indexer: ${indexerStatus ?? "N/A"}, on-chain: ${onchainStatus ?? "N/A"})`);
    console.log(`      TVL: ${(Number(market.currentTvl) / 1e6).toFixed(2)} USDC | Trades: ${market.totalTrades}`);
    console.log();
  }
  
  log(`\n📊 Checking ${pariMarkets.length} PariMutuel markets...`, colors.yellow);
  
  for (const market of pariMarkets) {
    const pollAddress = market.pollAddress as Address;
    const indexerPoll = pollLookup.get(pollAddress?.toLowerCase());
    const indexerStatus = indexerPoll?.status;
    
    // Get on-chain status
    const onchainStatus = pollAddress ? await getOnChainPollStatus(pollAddress) : null;
    
    const statusMatch = indexerStatus === onchainStatus;
    if (statusMatch) matchedStatus++;
    else mismatchedStatus++;
    
    const isActive = onchainStatus === 0;
    if (isActive) {
      activePari.push(market);
    } else if (onchainStatus !== null) {
      resolvedPari.push(market);
    } else {
      unknownStatus.push(market);
    }
    
    const statusLabel = onchainStatus !== null ? POLL_STATUS[onchainStatus as keyof typeof POLL_STATUS] : "UNKNOWN";
    const statusIcon = isActive ? "🟢" : (onchainStatus !== null ? "🔴" : "⚪");
    const matchIcon = statusMatch ? "✅" : "❌";
    
    console.log(`${matchIcon} ${statusIcon} [PARI] ${market.id.slice(0, 10)}...`);
    console.log(`      Poll: ${pollAddress?.slice(0, 10) ?? "N/A"}...`);
    console.log(`      Status: ${statusLabel} (indexer: ${indexerStatus ?? "N/A"}, on-chain: ${onchainStatus ?? "N/A"})`);
    console.log(`      TVL: ${(Number(market.currentTvl) / 1e6).toFixed(2)} USDC | Trades: ${market.totalTrades}`);
    console.log();
  }

  // Summary
  log("=".repeat(70), colors.bright);
  log("  SUMMARY", colors.bright);
  log("=".repeat(70), colors.bright);
  
  console.log(`\n📊 Status Verification:`);
  log(`   ✅ Matched:    ${matchedStatus}`, colors.green);
  if (mismatchedStatus > 0) {
    log(`   ❌ Mismatched: ${mismatchedStatus}`, colors.red);
  }
  
  console.log(`\n📈 Market Counts:`);
  console.log(`   Total Markets:     ${markets.length}`);
  console.log(`   AMM Markets:       ${ammMarkets.length}`);
  console.log(`   PariMutuel:        ${pariMarkets.length}`);
  
  console.log(`\n📊 Platform Stats (from indexer):`);
  console.log(`   totalMarkets:      ${platformStats.totalMarkets}`);
  console.log(`   totalAmmMarkets:   ${platformStats.totalAmmMarkets}`);
  console.log(`   totalPariMarkets:  ${platformStats.totalPariMarkets}`);
  
  // Verify platform stats match
  const statsMatch = platformStats.totalMarkets === markets.length &&
                     platformStats.totalAmmMarkets === ammMarkets.length &&
                     platformStats.totalPariMarkets === pariMarkets.length;
  
  if (statsMatch) {
    log(`\n✅ Platform stats match market counts!`, colors.green);
  } else {
    log(`\n❌ Platform stats DON'T match:`, colors.red);
    if (platformStats.totalMarkets !== markets.length) {
      console.log(`   totalMarkets: ${platformStats.totalMarkets} vs actual ${markets.length}`);
    }
    if (platformStats.totalAmmMarkets !== ammMarkets.length) {
      console.log(`   totalAmmMarkets: ${platformStats.totalAmmMarkets} vs actual ${ammMarkets.length}`);
    }
    if (platformStats.totalPariMarkets !== pariMarkets.length) {
      console.log(`   totalPariMarkets: ${platformStats.totalPariMarkets} vs actual ${pariMarkets.length}`);
    }
  }
  
  log("\n" + "=".repeat(70), colors.bright);
  log("  ACTIVE vs RESOLVED", colors.bright);
  log("=".repeat(70), colors.bright);
  
  console.log(`\n🟢 ACTIVE Markets (poll status = PENDING):`);
  console.log(`   AMM:        ${activeAmm.length}`);
  console.log(`   PariMutuel: ${activePari.length}`);
  log(`   TOTAL:      ${activeAmm.length + activePari.length}`, colors.green);
  
  console.log(`\n🔴 RESOLVED Markets (poll status = YES/NO/UNKNOWN):`);
  console.log(`   AMM:        ${resolvedAmm.length}`);
  console.log(`   PariMutuel: ${resolvedPari.length}`);
  console.log(`   TOTAL:      ${resolvedAmm.length + resolvedPari.length}`);
  
  if (unknownStatus.length > 0) {
    log(`\n⚪ UNKNOWN Status: ${unknownStatus.length}`, colors.yellow);
  }
  
  // Active markets details
  if (activeAmm.length + activePari.length > 0) {
    log("\n📋 Active Markets Details:", colors.cyan);
    
    const allActive = [...activeAmm, ...activePari].sort((a, b) => 
      Number(b.currentTvl) - Number(a.currentTvl)
    );
    
    for (const market of allActive) {
      const type = market.marketType.toUpperCase().padEnd(4);
      const tvl = (Number(market.currentTvl) / 1e6).toFixed(2);
      const poll = pollLookup.get(market.pollAddress?.toLowerCase());
      const question = poll?.question?.slice(0, 40) ?? "Unknown";
      console.log(`   [${type}] ${market.id.slice(0, 10)}... - ${tvl} USDC TVL`);
      console.log(`           ${question}...`);
    }
  }
  
  console.log();
}

main().catch(console.error);

