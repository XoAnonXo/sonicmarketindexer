import { createPublicClient, http, parseAbiItem, formatUnits, type Address, type Log } from "viem";
import { sonic } from "viem/chains";

const RPC_URL = "https://rpc.soniclabs.com";
const client = createPublicClient({ chain: sonic, transport: http(RPC_URL) });

// Top market by volume
const MARKET = "0x9dd6df336775fe9d91f687f80b57390f3833337b" as Address;
const START_BLOCK = 56_000_000n;

const BuyTokensEvent = parseAbiItem(
  "event BuyTokens(address indexed trader, bool indexed isYes, uint256 tokenAmount, uint256 collateralAmount, uint256 fee)"
);
const SellTokensEvent = parseAbiItem(
  "event SellTokens(address indexed trader, bool indexed isYes, uint256 tokenAmount, uint256 collateralAmount, uint256 fee)"
);
const SwapTokensEvent = parseAbiItem(
  "event SwapTokens(address indexed trader, bool fromYes, uint256 amountIn, uint256 amountOut, uint256 fee)"
);

async function main() {
  const currentBlock = await client.getBlockNumber();
  console.log(`\nChecking market: ${MARKET}`);
  console.log(`Block range: ${START_BLOCK} to ${currentBlock}\n`);

  // Get all events
  const [buyLogs, sellLogs, swapLogs] = await Promise.all([
    client.getLogs({ address: MARKET, event: BuyTokensEvent, fromBlock: START_BLOCK, toBlock: currentBlock }),
    client.getLogs({ address: MARKET, event: SellTokensEvent, fromBlock: START_BLOCK, toBlock: currentBlock }),
    client.getLogs({ address: MARKET, event: SwapTokensEvent, fromBlock: START_BLOCK, toBlock: currentBlock }),
  ]);

  console.log(`Buy events: ${buyLogs.length}`);
  console.log(`Sell events: ${sellLogs.length}`);
  console.log(`Swap events: ${swapLogs.length}`);
  console.log(`Total trades: ${buyLogs.length + sellLogs.length + swapLogs.length}`);

  let totalVolume = 0n;
  let totalFees = 0n;
  const uniqueTraders = new Set<string>();

  // Process buys
  for (const log of buyLogs) {
    const args = (log as any).args;
    totalVolume += args.collateralAmount ?? 0n;
    totalFees += args.fee ?? 0n;
    uniqueTraders.add(args.trader.toLowerCase());
  }

  // Process sells
  for (const log of sellLogs) {
    const args = (log as any).args;
    totalVolume += args.collateralAmount ?? 0n;
    totalFees += args.fee ?? 0n;
    uniqueTraders.add(args.trader.toLowerCase());
  }

  // Process swaps
  for (const log of swapLogs) {
    const args = (log as any).args;
    // Swaps don't have collateralAmount, but have amountIn
    totalFees += args.fee ?? 0n;
    uniqueTraders.add(args.trader.toLowerCase());
  }

  console.log(`\nTotal Volume: ${formatUnits(totalVolume, 6)} USDC`);
  console.log(`Total Fees: ${formatUnits(totalFees, 6)} USDC`);
  console.log(`Unique Traders: ${uniqueTraders.size}`);

  // Show sample buy event
  if (buyLogs.length > 0) {
    console.log("\nSample Buy event args:");
    console.log(JSON.stringify((buyLogs[0] as any).args, (_, v) => typeof v === 'bigint' ? v.toString() : v, 2));
  }
}

main().catch(console.error);
