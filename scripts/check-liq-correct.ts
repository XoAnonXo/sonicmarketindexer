import { createPublicClient, http, parseAbiItem, type Address } from "viem";
import { sonic } from "viem/chains";

const RPC_URL = "https://rpc.soniclabs.com";
const client = createPublicClient({ chain: sonic, transport: http(RPC_URL) });
const START_BLOCK = 56_000_000n;
const FACTORY = "0x017277d36f80422a5d0aA5B8C93f5ae57BA2A317" as Address;

// Full event signatures from ABI
const MarketCreatedEvent = parseAbiItem(
  "event MarketCreated(address indexed pollAddress, address indexed marketAddress, address indexed creator, address yesToken, address noToken, address collateral, uint24 feeTier, uint24 maxPriceImbalancePerHour)"
);

// Correct signature - check the ABI
const LiquidityAddedEvent = parseAbiItem(
  "event LiquidityAdded(address indexed provider, uint256 collateralAmount, uint256 lpAmount, uint256 yesBalance, uint256 noBalance)"
);

async function main() {
  const currentBlock = await client.getBlockNumber();

  const ammLogs = await client.getLogs({ 
    address: FACTORY, 
    event: MarketCreatedEvent, 
    fromBlock: START_BLOCK, 
    toBlock: currentBlock 
  });

  console.log(`AMM Markets: ${ammLogs.length}\n`);

  let totalAdds = 0;

  for (const log of ammLogs) {
    const market = (log as any).args.marketAddress as Address;
    
    const addLogs = await client.getLogs({ 
      address: market, 
      event: LiquidityAddedEvent, 
      fromBlock: START_BLOCK, 
      toBlock: currentBlock 
    });

    if (addLogs.length > 0) {
      console.log(`${market}: ${addLogs.length} LiquidityAdded events`);
    }
    totalAdds += addLogs.length;
    await new Promise(r => setTimeout(r, 50));
  }

  console.log(`\nTotal LiquidityAdded events: ${totalAdds}`);
}

main().catch(console.error);
