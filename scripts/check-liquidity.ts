import { createPublicClient, http, parseAbiItem, type Address } from "viem";
import { sonic } from "viem/chains";

const RPC_URL = "https://rpc.soniclabs.com";
const client = createPublicClient({ chain: sonic, transport: http(RPC_URL) });
const START_BLOCK = 56_000_000n;
const FACTORY = "0x017277d36f80422a5d0aA5B8C93f5ae57BA2A317" as Address;

const MarketCreatedEvent = parseAbiItem(
  "event MarketCreated(address indexed pollAddress, address indexed marketAddress, address indexed creator, address yesToken, address noToken, address collateral, uint24 feeTier, uint24 maxPriceImbalancePerHour)"
);
const LiquidityAddedEvent = parseAbiItem(
  "event LiquidityAdded(address indexed provider, uint256 collateralAmount, uint256 lpAmount, uint256 yesBalance, uint256 noBalance)"
);
const LiquidityRemovedEvent = parseAbiItem(
  "event LiquidityRemoved(address indexed provider, uint256 lpAmount, uint256 collateralReceived, uint256 yesBalance, uint256 noBalance)"
);

async function main() {
  const currentBlock = await client.getBlockNumber();
  console.log(`Block range: ${START_BLOCK} to ${currentBlock}\n`);

  // Get all AMM markets
  const ammLogs = await client.getLogs({ 
    address: FACTORY, 
    event: MarketCreatedEvent, 
    fromBlock: START_BLOCK, 
    toBlock: currentBlock 
  });

  console.log(`AMM Markets: ${ammLogs.length}\n`);

  let totalLiquidityAdded = 0;
  let totalLiquidityRemoved = 0;
  const liquidityProviders = new Set<string>();

  console.log("=== LIQUIDITY EVENTS ===");
  for (const log of ammLogs) {
    const market = (log as any).args.marketAddress as Address;
    
    const [addLogs, removeLogs] = await Promise.all([
      client.getLogs({ address: market, event: LiquidityAddedEvent, fromBlock: START_BLOCK, toBlock: currentBlock }),
      client.getLogs({ address: market, event: LiquidityRemovedEvent, fromBlock: START_BLOCK, toBlock: currentBlock }),
    ]);

    if (addLogs.length > 0 || removeLogs.length > 0) {
      console.log(`${market}: ${addLogs.length} adds, ${removeLogs.length} removes`);
    }

    totalLiquidityAdded += addLogs.length;
    totalLiquidityRemoved += removeLogs.length;

    for (const l of addLogs) {
      liquidityProviders.add((l as any).args.provider.toLowerCase());
    }
    for (const l of removeLogs) {
      liquidityProviders.add((l as any).args.provider.toLowerCase());
    }

    await new Promise(r => setTimeout(r, 50));
  }

  console.log("\n=== SUMMARY ===");
  console.log(`Total LiquidityAdded events: ${totalLiquidityAdded}`);
  console.log(`Total LiquidityRemoved events: ${totalLiquidityRemoved}`);
  console.log(`Total liquidity events: ${totalLiquidityAdded + totalLiquidityRemoved}`);
  console.log(`Unique liquidity providers: ${liquidityProviders.size}`);
}

main().catch(console.error);
