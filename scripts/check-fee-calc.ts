import { createPublicClient, http, parseAbiItem, formatUnits, type Address } from "viem";
import { sonic } from "viem/chains";

const RPC_URL = "https://rpc.soniclabs.com";
const client = createPublicClient({ chain: sonic, transport: http(RPC_URL) });
const START_BLOCK = 56_000_000n;
const FACTORY = "0x017277d36f80422a5d0aA5B8C93f5ae57BA2A317" as Address;

const MarketCreatedEvent = parseAbiItem(
  "event MarketCreated(address indexed pollAddress, address indexed marketAddress, address indexed creator, address yesToken, address noToken, address collateral, uint24 feeTier, uint24 maxPriceImbalancePerHour)"
);
const BuyTokensEvent = parseAbiItem(
  "event BuyTokens(address indexed trader, bool indexed isYes, uint256 tokenAmount, uint256 collateralAmount, uint256 fee)"
);
const SellTokensEvent = parseAbiItem(
  "event SellTokens(address indexed trader, bool indexed isYes, uint256 tokenAmount, uint256 collateralAmount, uint256 fee)"
);

async function main() {
  const currentBlock = await client.getBlockNumber();

  // Get all AMM markets with feeTier
  const ammLogs = await client.getLogs({ 
    address: FACTORY, 
    event: MarketCreatedEvent, 
    fromBlock: START_BLOCK, 
    toBlock: currentBlock 
  });

  console.log("Calculating fees based on volume × feeTier/1_000_000:\n");

  let totalVolume = 0n;
  let totalCalculatedFees = 0n;
  let totalEventFees = 0n;

  for (const log of ammLogs) {
    const market = (log as any).args.marketAddress as Address;
    const feeTier = BigInt((log as any).args.feeTier);
    
    const [buyLogs, sellLogs] = await Promise.all([
      client.getLogs({ address: market, event: BuyTokensEvent, fromBlock: START_BLOCK, toBlock: currentBlock }),
      client.getLogs({ address: market, event: SellTokensEvent, fromBlock: START_BLOCK, toBlock: currentBlock }),
    ]);

    let marketVolume = 0n;
    let marketEventFees = 0n;

    for (const l of buyLogs) {
      const args = (l as any).args;
      marketVolume += args.collateralAmount ?? 0n;
      marketEventFees += args.fee ?? 0n;
    }
    for (const l of sellLogs) {
      const args = (l as any).args;
      marketVolume += args.collateralAmount ?? 0n;
      marketEventFees += args.fee ?? 0n;
    }

    // Calculate fees: volume * feeTier / 1_000_000
    const calculatedFees = (marketVolume * feeTier) / 1_000_000n;

    if (marketVolume > 0n) {
      console.log(`${market}:`);
      console.log(`  feeTier: ${feeTier} (${Number(feeTier)/10000}%)`);
      console.log(`  volume: ${formatUnits(marketVolume, 6)} USDC`);
      console.log(`  event fees: ${formatUnits(marketEventFees, 6)} USDC`);
      console.log(`  calculated fees: ${formatUnits(calculatedFees, 6)} USDC`);
      console.log();
    }

    totalVolume += marketVolume;
    totalCalculatedFees += calculatedFees;
    totalEventFees += marketEventFees;

    await new Promise(r => setTimeout(r, 50));
  }

  console.log("=== SUMMARY ===");
  console.log(`Total AMM Volume: ${formatUnits(totalVolume, 6)} USDC`);
  console.log(`Total Event Fees: ${formatUnits(totalEventFees, 6)} USDC`);
  console.log(`Total Calculated Fees: ${formatUnits(totalCalculatedFees, 6)} USDC`);
}

main().catch(console.error);
