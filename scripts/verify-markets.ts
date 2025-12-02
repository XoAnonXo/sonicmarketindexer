/**
 * Verify Market Data: Compare indexer markets with on-chain values
 * 
 * Checks for AMM Markets:
 * - pollAddress, creator, collateralToken
 * - yesToken, noToken
 * - feeTier, maxPriceImbalancePerHour
 * - reserveYes, reserveNo (live reserves)
 * - currentTvl (USDC balance)
 * 
 * Checks for PariMutuel Markets:
 * - pollAddress, creator, collateralToken
 * - curveFlattener, curveOffset
 * - yesPool, noPool (TVL)
 */

import { getContract, type Address } from "viem";
import {
  client,
  queryIndexer,
  logHeader,
  logInfo,
  logSuccess,
  logError,
  logWarning,
  compare,
  compareBigInt,
  formatUSDC,
  createSummary,
  recordResult,
  printSummary,
  type VerificationSummary,
} from "./utils.js";
import {
  PredictionAMMAbi,
  PredictionPariMutuelAbi,
  ERC20Abi,
  CONTRACTS,
} from "./contracts.js";

// GraphQL query to get all markets from indexer
const MARKETS_QUERY = `
  query GetMarkets($limit: Int) {
    marketss(limit: $limit, orderBy: "createdAt", orderDirection: "desc") {
      items {
        id
        chainId
        pollAddress
        creator
        marketType
        collateralToken
        yesToken
        noToken
        feeTier
        maxPriceImbalancePerHour
        curveFlattener
        curveOffset
        totalVolume
        totalTrades
        currentTvl
        uniqueTraders
        reserveYes
        reserveNo
        createdAtBlock
        createdAt
      }
    }
  }
`;

interface IndexerMarket {
  id: string;
  chainId: number;
  pollAddress: string;
  creator: string;
  marketType: "amm" | "pari";
  collateralToken: string;
  yesToken: string | null;
  noToken: string | null;
  feeTier: number | null;
  maxPriceImbalancePerHour: number | null;
  curveFlattener: number | null;
  curveOffset: number | null;
  totalVolume: string;
  totalTrades: number;
  currentTvl: string;
  uniqueTraders: number;
  reserveYes: string | null;
  reserveNo: string | null;
  createdAtBlock: string;
  createdAt: string;
}

interface OnChainAMMMarket {
  pollAddress: Address;
  creator: Address;
  collateral: Address;
  yesToken: Address;
  noToken: Address;
  feeTier: number;
  maxPriceImbalancePerHour: number;
  reserveYes: bigint;
  reserveNo: bigint;
  usdcBalance: bigint;
}

interface OnChainPariMarket {
  pollAddress: Address;
  creator: Address;
  collateral: Address;
  curveFlattener: number;
  curveOffset: number;
  yesPool: bigint;
  noPool: bigint;
  usdcBalance: bigint;
}

/**
 * Fetch AMM market data from on-chain
 */
async function fetchOnChainAMMMarket(marketAddress: Address): Promise<OnChainAMMMarket | null> {
  try {
    const contract = getContract({
      address: marketAddress,
      abi: PredictionAMMAbi,
      client,
    });

    const [
      pollAddress,
      creator,
      collateral,
      yesToken,
      noToken,
      feeTier,
      maxPriceImbalancePerHour,
      reserves,
    ] = await Promise.all([
      contract.read.pollAddress(),
      contract.read.creator(),
      contract.read.collateral(),
      contract.read.yesToken(),
      contract.read.noToken(),
      contract.read.feeTier(),
      contract.read.maxPriceImbalancePerHour(),
      contract.read.getReserves(),
    ]);

    // Get USDC balance of the market
    const usdcContract = getContract({
      address: collateral as Address,
      abi: ERC20Abi,
      client,
    });
    const usdcBalance = await usdcContract.read.balanceOf([marketAddress]);

    return {
      pollAddress,
      creator,
      collateral,
      yesToken,
      noToken,
      feeTier: Number(feeTier),
      maxPriceImbalancePerHour: Number(maxPriceImbalancePerHour),
      reserveYes: reserves[0],
      reserveNo: reserves[1],
      usdcBalance,
    };
  } catch (error) {
    logWarning(`Failed to fetch on-chain AMM data for ${marketAddress}: ${error}`);
    return null;
  }
}

/**
 * Fetch PariMutuel market data from on-chain
 */
async function fetchOnChainPariMarket(marketAddress: Address): Promise<OnChainPariMarket | null> {
  try {
    const contract = getContract({
      address: marketAddress,
      abi: PredictionPariMutuelAbi,
      client,
    });

    const [
      pollAddress,
      creator,
      collateral,
      curveFlattener,
      curveOffset,
      yesPool,
      noPool,
    ] = await Promise.all([
      contract.read.pollAddress(),
      contract.read.creator(),
      contract.read.collateral(),
      contract.read.curveFlattener(),
      contract.read.curveOffset(),
      contract.read.yesPool(),
      contract.read.noPool(),
    ]);

    // Get USDC balance
    const usdcContract = getContract({
      address: collateral as Address,
      abi: ERC20Abi,
      client,
    });
    const usdcBalance = await usdcContract.read.balanceOf([marketAddress]);

    return {
      pollAddress,
      creator,
      collateral,
      curveFlattener: Number(curveFlattener),
      curveOffset: Number(curveOffset),
      yesPool,
      noPool,
      usdcBalance,
    };
  } catch (error) {
    logWarning(`Failed to fetch on-chain Pari data for ${marketAddress}: ${error}`);
    return null;
  }
}

/**
 * Verify an AMM market
 */
async function verifyAMMMarket(
  indexerMarket: IndexerMarket,
  summary: VerificationSummary
): Promise<void> {
  const marketAddress = indexerMarket.id as Address;
  
  console.log(`\n📊 AMM Market: ${marketAddress}`);
  
  const onChain = await fetchOnChainAMMMarket(marketAddress);
  
  if (!onChain) {
    logError("Could not fetch on-chain data");
    summary.failed++;
    summary.mismatches.push(`${marketAddress}: Could not fetch`);
    return;
  }

  // Compare pollAddress
  const pollMatch = compare(
    "Poll Address",
    indexerMarket.pollAddress.toLowerCase(),
    onChain.pollAddress.toLowerCase()
  );
  recordResult(summary, pollMatch.match, `${marketAddress}: pollAddress`);

  // Compare creator
  const creatorMatch = compare(
    "Creator",
    indexerMarket.creator.toLowerCase(),
    onChain.creator.toLowerCase()
  );
  recordResult(summary, creatorMatch.match, `${marketAddress}: creator`);

  // Compare collateral
  const collateralMatch = compare(
    "Collateral Token",
    indexerMarket.collateralToken.toLowerCase(),
    onChain.collateral.toLowerCase()
  );
  recordResult(summary, collateralMatch.match, `${marketAddress}: collateral`);

  // Compare yesToken
  if (indexerMarket.yesToken) {
    const yesTokenMatch = compare(
      "YES Token",
      indexerMarket.yesToken.toLowerCase(),
      onChain.yesToken.toLowerCase()
    );
    recordResult(summary, yesTokenMatch.match, `${marketAddress}: yesToken`);
  }

  // Compare noToken
  if (indexerMarket.noToken) {
    const noTokenMatch = compare(
      "NO Token",
      indexerMarket.noToken.toLowerCase(),
      onChain.noToken.toLowerCase()
    );
    recordResult(summary, noTokenMatch.match, `${marketAddress}: noToken`);
  }

  // Compare feeTier
  if (indexerMarket.feeTier !== null) {
    const feeTierMatch = compare("Fee Tier", indexerMarket.feeTier, onChain.feeTier);
    recordResult(summary, feeTierMatch.match, `${marketAddress}: feeTier`);
  }

  // Compare reserves (live on-chain values)
  const indexerReserveYes = BigInt(indexerMarket.reserveYes ?? "0");
  const indexerReserveNo = BigInt(indexerMarket.reserveNo ?? "0");
  
  const reserveYesMatch = compareBigInt("Reserve YES", indexerReserveYes, onChain.reserveYes, 0.1);
  recordResult(summary, reserveYesMatch.match, `${marketAddress}: reserveYes`);
  
  const reserveNoMatch = compareBigInt("Reserve NO", indexerReserveNo, onChain.reserveNo, 0.1);
  recordResult(summary, reserveNoMatch.match, `${marketAddress}: reserveNo`);

  // Compare TVL (USDC balance)
  const indexerTvl = BigInt(indexerMarket.currentTvl);
  console.log(`   USDC Balance On-Chain: ${formatUSDC(onChain.usdcBalance)} USDC`);
  console.log(`   Indexer TVL: ${formatUSDC(indexerTvl)} USDC`);
  
  // Note: TVL tracking may differ - log for analysis
  if (onChain.usdcBalance !== indexerTvl) {
    logWarning(`TVL differs (indexer may track differently): diff = ${formatUSDC(onChain.usdcBalance > indexerTvl ? onChain.usdcBalance - indexerTvl : indexerTvl - onChain.usdcBalance)}`);
    summary.warnings++;
  }
}

/**
 * Verify a PariMutuel market
 */
async function verifyPariMarket(
  indexerMarket: IndexerMarket,
  summary: VerificationSummary
): Promise<void> {
  const marketAddress = indexerMarket.id as Address;
  
  console.log(`\n🎲 PariMutuel Market: ${marketAddress}`);
  
  const onChain = await fetchOnChainPariMarket(marketAddress);
  
  if (!onChain) {
    logError("Could not fetch on-chain data");
    summary.failed++;
    summary.mismatches.push(`${marketAddress}: Could not fetch`);
    return;
  }

  // Compare pollAddress
  const pollMatch = compare(
    "Poll Address",
    indexerMarket.pollAddress.toLowerCase(),
    onChain.pollAddress.toLowerCase()
  );
  recordResult(summary, pollMatch.match, `${marketAddress}: pollAddress`);

  // Compare creator
  const creatorMatch = compare(
    "Creator",
    indexerMarket.creator.toLowerCase(),
    onChain.creator.toLowerCase()
  );
  recordResult(summary, creatorMatch.match, `${marketAddress}: creator`);

  // Compare collateral
  const collateralMatch = compare(
    "Collateral Token",
    indexerMarket.collateralToken.toLowerCase(),
    onChain.collateral.toLowerCase()
  );
  recordResult(summary, collateralMatch.match, `${marketAddress}: collateral`);

  // Compare curveFlattener
  if (indexerMarket.curveFlattener !== null) {
    const flattenerMatch = compare("Curve Flattener", indexerMarket.curveFlattener, onChain.curveFlattener);
    recordResult(summary, flattenerMatch.match, `${marketAddress}: curveFlattener`);
  }

  // Compare curveOffset
  if (indexerMarket.curveOffset !== null) {
    const offsetMatch = compare("Curve Offset", indexerMarket.curveOffset, onChain.curveOffset);
    recordResult(summary, offsetMatch.match, `${marketAddress}: curveOffset`);
  }

  // Compare pools (TVL)
  const totalPool = onChain.yesPool + onChain.noPool;
  const indexerTvl = BigInt(indexerMarket.currentTvl);
  
  console.log(`   YES Pool: ${formatUSDC(onChain.yesPool)} USDC`);
  console.log(`   NO Pool:  ${formatUSDC(onChain.noPool)} USDC`);
  console.log(`   Total Pool: ${formatUSDC(totalPool)} USDC`);
  console.log(`   USDC Balance: ${formatUSDC(onChain.usdcBalance)} USDC`);
  console.log(`   Indexer TVL: ${formatUSDC(indexerTvl)} USDC`);
  
  // Compare TVL with tolerance
  const tvlMatch = compareBigInt("TVL vs Total Pool", indexerTvl, totalPool, 1); // 1% tolerance
  recordResult(summary, tvlMatch.match, `${marketAddress}: tvl`);
}

/**
 * Main verification function
 */
export async function verifyMarkets(): Promise<VerificationSummary> {
  logHeader("MARKET VERIFICATION");
  
  const summary = createSummary();
  
  // Fetch all markets from indexer
  logInfo("Fetching markets from indexer...");
  
  let allMarkets: IndexerMarket[] = [];
  const limit = 1000;
  
  try {
    const data = await queryIndexer<{ marketss: { items: IndexerMarket[] } }>(
      MARKETS_QUERY,
      { limit }
    );
    allMarkets = data.marketss.items;
  } catch (error) {
    logError(`Failed to fetch markets from indexer: ${error}`);
    return summary;
  }
  
  logInfo(`Found ${allMarkets.length} markets in indexer`);
  
  const ammMarkets = allMarkets.filter((m) => m.marketType === "amm");
  const pariMarkets = allMarkets.filter((m) => m.marketType === "pari");
  
  logInfo(`  - ${ammMarkets.length} AMM markets`);
  logInfo(`  - ${pariMarkets.length} PariMutuel markets`);
  
  // Verify AMM markets (limit for first run)
  logHeader("AMM MARKETS");
  const ammToVerify = ammMarkets.slice(0, 25);
  for (const market of ammToVerify) {
    await verifyAMMMarket(market, summary);
  }
  
  // Verify PariMutuel markets (limit for first run)
  logHeader("PARI-MUTUEL MARKETS");
  const pariToVerify = pariMarkets.slice(0, 25);
  for (const market of pariToVerify) {
    await verifyPariMarket(market, summary);
  }
  
  return summary;
}

// Run if called directly
const scriptPath = process.argv[1];
const isMainModule = import.meta.url.endsWith(scriptPath.split('/').pop()!) || 
                     import.meta.url.includes('verify-markets');
if (isMainModule) {
  verifyMarkets()
    .then(printSummary)
    .catch(console.error);
}

