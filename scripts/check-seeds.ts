import { createPublicClient, http, parseAbiItem, type Address } from "viem";
import { sonic } from "viem/chains";

const RPC_URL = "https://rpc.soniclabs.com";
const client = createPublicClient({ chain: sonic, transport: http(RPC_URL) });
const START_BLOCK = 56_000_000n;
const FACTORY = "0x017277d36f80422a5d0aA5B8C93f5ae57BA2A317" as Address;

const PariMutuelCreatedEvent = parseAbiItem(
  "event PariMutuelCreated(address indexed pollAddress, address indexed marketAddress, address indexed creator, address collateral, uint8 curveFlattener, uint24 curveOffset)"
);
const SeedInitialLiquidityEvent = parseAbiItem(
  "event SeedInitialLiquidity(address indexed creator, uint256 yesAmount, uint256 noAmount)"
);

async function main() {
  const currentBlock = await client.getBlockNumber();
  console.log(`Block range: ${START_BLOCK} to ${currentBlock}\n`);

  // Get all Pari markets
  const pariLogs = await client.getLogs({ 
    address: FACTORY, 
    event: PariMutuelCreatedEvent, 
    fromBlock: START_BLOCK, 
    toBlock: currentBlock 
  });

  console.log(`Pari Markets: ${pariLogs.length}\n`);

  let totalSeeds = 0;
  const seedCreators = new Set<string>();

  console.log("=== SEED EVENTS ===");
  for (const log of pariLogs) {
    const market = (log as any).args.marketAddress as Address;
    
    const seedLogs = await client.getLogs({ 
      address: market, 
      event: SeedInitialLiquidityEvent, 
      fromBlock: START_BLOCK, 
      toBlock: currentBlock 
    });

    if (seedLogs.length > 0) {
      console.log(`${market}: ${seedLogs.length} seed events`);
      for (const l of seedLogs) {
        seedCreators.add((l as any).args.creator.toLowerCase());
      }
    }

    totalSeeds += seedLogs.length;
    await new Promise(r => setTimeout(r, 50));
  }

  console.log("\n=== SUMMARY ===");
  console.log(`Total SeedInitialLiquidity events: ${totalSeeds}`);
  console.log(`Unique seed creators: ${seedCreators.size}`);
}

main().catch(console.error);
