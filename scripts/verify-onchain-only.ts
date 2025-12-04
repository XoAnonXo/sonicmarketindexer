#!/usr/bin/env tsx
/**
 * On-Chain Only Verification Script
 * 
 * This script fetches data directly from the blockchain without requiring
 * the indexer to be running. Useful for initial validation or debugging.
 * 
 * Usage:
 *   ./node_modules/.bin/tsx verify-onchain-only.ts
 */

import { createPublicClient, http, parseAbiItem, getContract, formatUnits, type Address } from "viem";
import { sonic } from "viem/chains";
import {
  CONTRACTS,
  PredictionPollAbi,
  PredictionAMMAbi,
  PredictionPariMutuelAbi,
  ERC20Abi,
  RPC_URL,
  USDC_DECIMALS,
} from "./contracts.js";

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
  blue: "\x1b[34m",
  cyan: "\x1b[36m",
};

function log(msg: string, color?: string) {
  console.log(color ? `${color}${msg}${colors.reset}` : msg);
}

function logHeader(title: string) {
  console.log();
  log("=".repeat(60), colors.bright);
  log(`  ${title}`, colors.bright);
  log("=".repeat(60), colors.bright);
  console.log();
}

function formatUSDC(amount: bigint): string {
  return formatUnits(amount, USDC_DECIMALS);
}

// Event ABIs
const PollCreatedEvent = parseAbiItem(
  "event PollCreated(address indexed pollAddress, address indexed creator, uint32 deadlineEpoch, string question)"
);

const MarketCreatedEvent = parseAbiItem(
  "event MarketCreated(address indexed pollAddress, address indexed marketAddress, address indexed creator, address yesToken, address noToken, address collateral, uint24 feeTier, uint24 maxPriceImbalancePerHour)"
);

const PariMutuelCreatedEvent = parseAbiItem(
  "event PariMutuelCreated(address indexed pollAddress, address indexed marketAddress, address indexed creator, address collateral, uint8 curveFlattener, uint24 curveOffset)"
);

const BuyTokensEvent = parseAbiItem(
  "event BuyTokens(address indexed trader, bool indexed isYes, uint256 tokenAmount, uint256 collateralAmount, uint256 fee)"
);

const SellTokensEvent = parseAbiItem(
  "event SellTokens(address indexed trader, bool indexed isYes, uint256 tokenAmount, uint256 collateralAmount, uint256 fee)"
);

const PositionPurchasedEvent = parseAbiItem(
  "event PositionPurchased(address indexed buyer, bool indexed isYes, uint256 collateralIn, uint256 sharesOut)"
);

const START_BLOCK = 56_000_000n;

/**
 * Fetch all events in block ranges
 */
async function fetchEventsInRange<T>(
  address: Address,
  event: any,
  fromBlock: bigint,
  toBlock: bigint,
  blockRange = 50000n
): Promise<T[]> {
  const allLogs: T[] = [];
  
  for (let start = fromBlock; start <= toBlock; start += blockRange) {
    const end = start + blockRange > toBlock ? toBlock : start + blockRange;
    
    try {
      const logs = await client.getLogs({
        address,
        event,
        fromBlock: start,
        toBlock: end,
      });
      allLogs.push(...(logs as unknown as T[]));
    } catch (error) {
      console.error(`Error fetching logs from ${start} to ${end}:`, error);
    }
    
    // Rate limiting
    await new Promise(r => setTimeout(r, 100));
  }
  
  return allLogs;
}

async function main() {
  logHeader("PANDORA ON-CHAIN VERIFICATION");
  
  log(`RPC URL: ${RPC_URL}`, colors.cyan);
  log(`Oracle: ${CONTRACTS.oracle}`, colors.cyan);
  log(`Market Factory: ${CONTRACTS.marketFactory}`, colors.cyan);
  
  const currentBlock = await client.getBlockNumber();
  log(`\nCurrent block: ${currentBlock}`, colors.cyan);
  log(`Start block: ${START_BLOCK}`, colors.cyan);
  console.log();

  // 1. Count Polls
  logHeader("POLLS");
  log("Fetching PollCreated events...", colors.yellow);
  
  const pollLogs = await fetchEventsInRange(
    CONTRACTS.oracle as Address,
    PollCreatedEvent,
    START_BLOCK,
    currentBlock
  );
  
  log(`✅ Total polls created: ${pollLogs.length}`, colors.green);
  
  // Show recent polls
  if (pollLogs.length > 0) {
    console.log("\nMost recent polls:");
    const recentPolls = pollLogs.slice(-5);
    for (const log of recentPolls) {
      const args = (log as any).args;
      console.log(`  - ${args.pollAddress}`);
      console.log(`    Question: "${args.question?.substring(0, 60)}..."`);
    }
  }

  // 2. Count AMM Markets
  logHeader("AMM MARKETS");
  log("Fetching MarketCreated events...", colors.yellow);
  
  const ammLogs = await fetchEventsInRange(
    CONTRACTS.marketFactory as Address,
    MarketCreatedEvent,
    START_BLOCK,
    currentBlock
  );
  
  log(`✅ Total AMM markets: ${ammLogs.length}`, colors.green);

  // 3. Count PariMutuel Markets
  logHeader("PARI-MUTUEL MARKETS");
  log("Fetching PariMutuelCreated events...", colors.yellow);
  
  const pariLogs = await fetchEventsInRange(
    CONTRACTS.marketFactory as Address,
    PariMutuelCreatedEvent,
    START_BLOCK,
    currentBlock
  );
  
  log(`✅ Total PariMutuel markets: ${pariLogs.length}`, colors.green);

  // 4. Calculate Volume from sample markets
  logHeader("VOLUME CALCULATION (Sample)");
  
  // Get first 5 AMM markets to check volume
  const ammMarketsToCheck = ammLogs.slice(0, 5);
  let totalAmmVolume = 0n;
  let totalAmmTrades = 0;
  let totalAmmFees = 0n;
  
  for (const marketLog of ammMarketsToCheck) {
    const marketAddress = (marketLog as any).args.marketAddress as Address;
    log(`\nChecking AMM market: ${marketAddress}`, colors.cyan);
    
    // Get buy events
    const buyLogs = await fetchEventsInRange(
      marketAddress,
      BuyTokensEvent,
      START_BLOCK,
      currentBlock,
      100000n
    );
    
    // Get sell events
    const sellLogs = await fetchEventsInRange(
      marketAddress,
      SellTokensEvent,
      START_BLOCK,
      currentBlock,
      100000n
    );
    
    let marketVolume = 0n;
    let marketFees = 0n;
    
    for (const log of buyLogs) {
      const args = (log as any).args;
      marketVolume += args.collateralAmount ?? 0n;
      marketFees += args.fee ?? 0n;
    }
    
    for (const log of sellLogs) {
      const args = (log as any).args;
      marketVolume += args.collateralAmount ?? 0n;
      marketFees += args.fee ?? 0n;
    }
    
    const trades = buyLogs.length + sellLogs.length;
    
    console.log(`   Buys: ${buyLogs.length}, Sells: ${sellLogs.length}`);
    console.log(`   Volume: ${formatUSDC(marketVolume)} USDC`);
    console.log(`   Fees: ${formatUSDC(marketFees)} USDC`);
    
    totalAmmVolume += marketVolume;
    totalAmmTrades += trades;
    totalAmmFees += marketFees;
  }
  
  // Get first 5 PariMutuel markets
  const pariMarketsToCheck = pariLogs.slice(0, 5);
  let totalPariVolume = 0n;
  let totalPariTrades = 0;
  
  for (const marketLog of pariMarketsToCheck) {
    const marketAddress = (marketLog as any).args.marketAddress as Address;
    log(`\nChecking Pari market: ${marketAddress}`, colors.cyan);
    
    // Get position purchased events
    const posLogs = await fetchEventsInRange(
      marketAddress,
      PositionPurchasedEvent,
      START_BLOCK,
      currentBlock,
      100000n
    );
    
    let marketVolume = 0n;
    
    for (const log of posLogs) {
      const args = (log as any).args;
      marketVolume += args.collateralIn ?? 0n;
    }
    
    console.log(`   Positions: ${posLogs.length}`);
    console.log(`   Volume: ${formatUSDC(marketVolume)} USDC`);
    
    totalPariVolume += marketVolume;
    totalPariTrades += posLogs.length;
  }

  // 5. Summary
  logHeader("SUMMARY");
  
  console.log(`📊 On-Chain Statistics:`);
  console.log(`   Total Polls:    ${pollLogs.length}`);
  console.log(`   AMM Markets:    ${ammLogs.length}`);
  console.log(`   Pari Markets:   ${pariLogs.length}`);
  console.log(`   Total Markets:  ${ammLogs.length + pariLogs.length}`);
  console.log();
  console.log(`📈 Sample Volume (${ammMarketsToCheck.length} AMM + ${pariMarketsToCheck.length} Pari markets):`);
  console.log(`   AMM Volume:     ${formatUSDC(totalAmmVolume)} USDC (${totalAmmTrades} trades)`);
  console.log(`   Pari Volume:    ${formatUSDC(totalPariVolume)} USDC (${totalPariTrades} trades)`);
  console.log(`   Total Sample:   ${formatUSDC(totalAmmVolume + totalPariVolume)} USDC`);
  console.log(`   Total Fees:     ${formatUSDC(totalAmmFees)} USDC`);
  
  console.log();
  log("✨ On-chain verification complete!", colors.green);
  console.log();
  log("To compare with indexer, start the indexer with:", colors.cyan);
  console.log("   cd .. && npm run dev");
  console.log();
  log("Then run the full verification:", colors.cyan);
  console.log("   npm run verify");
}

main().catch(console.error);




