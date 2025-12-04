import { createPublicClient, http, parseAbiItem, formatUnits, type Address } from "viem";
import { sonic } from "viem/chains";

const RPC_URL = "https://rpc.soniclabs.com";
const client = createPublicClient({ chain: sonic, transport: http(RPC_URL) });
const START_BLOCK = 56_000_000n;
const FACTORY = "0x017277d36f80422a5d0aA5B8C93f5ae57BA2A317" as Address;

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
const SwapTokensEvent = parseAbiItem(
  "event SwapTokens(address indexed trader, bool fromYes, uint256 amountIn, uint256 amountOut, uint256 fee)"
);
const PositionPurchasedEvent = parseAbiItem(
  "event PositionPurchased(address indexed buyer, bool indexed isYes, uint256 collateralIn, uint256 sharesOut)"
);
const SeedInitialLiquidityEvent = parseAbiItem(
  "event SeedInitialLiquidity(address indexed creator, uint256 yesAmount, uint256 noAmount)"
);

async function main() {
  const currentBlock = await client.getBlockNumber();
  console.log(`Block range: ${START_BLOCK} to ${currentBlock}\n`);

  // Get all markets
  const [ammLogs, pariLogs] = await Promise.all([
    client.getLogs({ address: FACTORY, event: MarketCreatedEvent, fromBlock: START_BLOCK, toBlock: currentBlock }),
    client.getLogs({ address: FACTORY, event: PariMutuelCreatedEvent, fromBlock: START_BLOCK, toBlock: currentBlock }),
  ]);

  console.log(`AMM Markets: ${ammLogs.length}`);
  console.log(`Pari Markets: ${pariLogs.length}\n`);

  let totalAmmTrades = 0;
  let totalPariTrades = 0;
  let totalAmmVolume = 0n;
  let totalPariVolume = 0n;
  const allUniqueTraders = new Set<string>();

  // Check all AMM markets
  console.log("=== AMM MARKETS ===");
  for (const log of ammLogs) {
    const market = (log as any).args.marketAddress as Address;
    const feeTier = (log as any).args.feeTier;
    
    const [buyLogs, sellLogs, swapLogs] = await Promise.all([
      client.getLogs({ address: market, event: BuyTokensEvent, fromBlock: START_BLOCK, toBlock: currentBlock }),
      client.getLogs({ address: market, event: SellTokensEvent, fromBlock: START_BLOCK, toBlock: currentBlock }),
      client.getLogs({ address: market, event: SwapTokensEvent, fromBlock: START_BLOCK, toBlock: currentBlock }),
    ]);

    const trades = buyLogs.length + sellLogs.length + swapLogs.length;
    let volume = 0n;
    const marketTraders = new Set<string>();

    for (const l of buyLogs) { 
      volume += (l as any).args.collateralAmount ?? 0n;
      marketTraders.add((l as any).args.trader.toLowerCase());
      allUniqueTraders.add((l as any).args.trader.toLowerCase());
    }
    for (const l of sellLogs) {
      volume += (l as any).args.collateralAmount ?? 0n;
      marketTraders.add((l as any).args.trader.toLowerCase());
      allUniqueTraders.add((l as any).args.trader.toLowerCase());
    }
    for (const l of swapLogs) {
      marketTraders.add((l as any).args.trader.toLowerCase());
      allUniqueTraders.add((l as any).args.trader.toLowerCase());
    }

    totalAmmTrades += trades;
    totalAmmVolume += volume;
    
    if (trades > 0) {
      console.log(`${market}: ${trades} trades, ${marketTraders.size} traders, feeTier=${feeTier}`);
    }
    await new Promise(r => setTimeout(r, 50));
  }

  // Check all Pari markets
  console.log("\n=== PARI MARKETS ===");
  for (const log of pariLogs) {
    const market = (log as any).args.marketAddress as Address;
    
    const [posLogs, seedLogs] = await Promise.all([
      client.getLogs({ address: market, event: PositionPurchasedEvent, fromBlock: START_BLOCK, toBlock: currentBlock }),
      client.getLogs({ address: market, event: SeedInitialLiquidityEvent, fromBlock: START_BLOCK, toBlock: currentBlock }),
    ]);

    const trades = posLogs.length + seedLogs.length;
    let volume = 0n;
    const marketTraders = new Set<string>();

    for (const l of posLogs) {
      volume += (l as any).args.collateralIn ?? 0n;
      marketTraders.add((l as any).args.buyer.toLowerCase());
      allUniqueTraders.add((l as any).args.buyer.toLowerCase());
    }
    for (const l of seedLogs) {
      // SeedInitialLiquidity has creator
      marketTraders.add((l as any).args.creator.toLowerCase());
      allUniqueTraders.add((l as any).args.creator.toLowerCase());
      // Volume from seeding - yesAmount + noAmount
      volume += ((l as any).args.yesAmount ?? 0n) + ((l as any).args.noAmount ?? 0n);
    }

    totalPariTrades += trades;
    totalPariVolume += volume;
    
    if (trades > 0) {
      console.log(`${market}: ${trades} trades (${posLogs.length} positions + ${seedLogs.length} seeds), ${marketTraders.size} traders`);
    }
    await new Promise(r => setTimeout(r, 50));
  }

  console.log("\n=== SUMMARY ===");
  console.log(`Total AMM Trades: ${totalAmmTrades}`);
  console.log(`Total Pari Trades: ${totalPariTrades}`);
  console.log(`TOTAL TRADES: ${totalAmmTrades + totalPariTrades}`);
  console.log(`\nTotal AMM Volume: ${formatUnits(totalAmmVolume, 6)} USDC`);
  console.log(`Total Pari Volume: ${formatUnits(totalPariVolume, 6)} USDC`);
  console.log(`TOTAL VOLUME: ${formatUnits(totalAmmVolume + totalPariVolume, 6)} USDC`);
  console.log(`\nUnique Traders: ${allUniqueTraders.size}`);
}

main().catch(console.error);
