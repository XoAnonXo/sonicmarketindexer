# Anymarket Indexer

A [Ponder](https://ponder.sh) blockchain indexer for the Anymarket prediction markets platform on Sonic Chain.

## Overview

This indexer listens to smart contract events, processes them, stores data in a database, and exposes a GraphQL API. The frontend uses this API to display platform statistics, leaderboards, and activity feeds.

```
┌─────────────────────────────────────────────────────────────────────────────┐
│                              SONIC CHAIN (ID: 146)                          │
│                                                                             │
│   PredictionOracle  →  MarketFactory  →  AMM / PariMutuel Markets          │
│   (Polls)               (Creates Markets)  (Trading Events)                 │
└─────────────────────────────────────────────────────────────────────────────┘
                                    │
                                    ▼
                    ┌─────────────────────────────────────┐
                    │         PONDER INDEXER              │
                    │                                     │
                    │   Event Handlers → Database         │
                    │         │              │            │
                    │         └──────────────┘            │
                    │                │                    │
                    │                ▼                    │
                    │          GraphQL API                │
                    │       localhost:42069               │
                    └─────────────────────────────────────┘
                                    │
                                    ▼
                    ┌─────────────────────────────────────┐
                    │       ANYMARKET FRONTEND            │
                    │                                     │
                    │   usePonderStats() → Statistics     │
                    └─────────────────────────────────────┘
```

## Quick Start

### Prerequisites

- Node.js >= 18.0.0
- npm or yarn

### Installation

```bash
cd ponder
npm install
```

### Development

```bash
# Generate types from schema
npm run codegen

# Start development server (hot reload)
npm run dev
```

The GraphQL API will be available at `http://localhost:42069/graphql`.

### Production

```bash
npm run start
```

## Configuration

### Environment Variables

Create a `.env` file:

```bash
# Required: Sonic Chain RPC endpoint
PONDER_RPC_URL_146=https://rpc.soniclabs.com

# Optional: Database URL (defaults to SQLite)
DATABASE_URL=postgresql://user:pass@host:5432/anymarket

# Optional: Max historical block range per request (performance tuning)
PONDER_MAX_HISTORICAL_TOTAL_BLOCKS=100000
```

### Contract Addresses

The indexer is configured for these Sonic mainnet contracts:

| Contract | Address |
|----------|---------|
| Oracle | `0x9492a0c32Fb22d1b8940e44C4D69f82B6C3cb298` |
| MarketFactory | `0x017277d36f80422a5d0aA5B8C93f5ae57BA2A317` |

To update addresses, modify `ponder.config.ts`.

## Project Structure

```
ponder/
├── ponder.config.ts     # Network and contract configuration
├── ponder.schema.ts     # Database schema definitions
├── src/
│   └── index.ts         # Event handlers
├── abis/                # Contract ABIs
│   ├── PredictionOracle.ts
│   ├── MarketFactory.ts
│   ├── PredictionAMM.ts
│   └── PredictionPariMutuel.ts
├── package.json
├── tsconfig.json
└── README.md
```

## Database Schema

### Tables

| Table | Description |
|-------|-------------|
| `polls` | Prediction polls from Oracle |
| `markets` | AMM and PariMutuel markets |
| `trades` | All trading activity |
| `users` | User statistics |
| `winnings` | Winning redemptions |
| `liquidityEvents` | LP add/remove events |
| `platformStats` | Global metrics (singleton) |
| `dailyStats` | Daily aggregations |
| `hourlyStats` | Hourly aggregations |

### Entity Relationships

```
polls (1) ────── (1) markets
     │
     └───────── (N) trades
                    │
                    └── (N) users
```

## Events Indexed

### PredictionOracle
- `PollCreated` → Creates poll record
- `PollRefreshed` → Updates check epoch

### MarketFactory
- `MarketCreated` → Creates AMM market
- `PariMutuelCreated` → Creates pari-mutuel market

### PredictionAMM
- `BuyTokens` → Records buy trade
- `SellTokens` → Records sell trade
- `SwapTokens` → Records token swap
- `WinningsRedeemed` → Records payout
- `LiquidityAdded` → Records LP deposit
- `LiquidityRemoved` → Records LP withdrawal

### PredictionPariMutuel
- `PositionPurchased` → Records bet
- `WinningsRedeemed` → Records payout

## GraphQL API

### Endpoints

| Path | Description |
|------|-------------|
| `/graphql` | GraphQL playground and API |
| `/health` | Health check |
| `/metrics` | Prometheus metrics |

### Example Queries

**Platform Statistics:**
```graphql
query {
  platformStats(id: "global") {
    totalPolls
    totalMarkets
    totalTrades
    totalUsers
    totalVolume
    totalLiquidity
    totalWinningsPaid
  }
}
```

**Leaderboard (Top Traders by Volume):**
```graphql
query {
  userss(orderBy: "totalVolume", orderDirection: "desc", limit: 10) {
    items {
      id
      totalTrades
      totalVolume
      totalWinnings
      totalWins
      bestStreak
    }
  }
}
```

**Recent Trades:**
```graphql
query {
  tradess(orderBy: "timestamp", orderDirection: "desc", limit: 20) {
    items {
      id
      trader
      tradeType
      side
      collateralAmount
      timestamp
    }
  }
}
```

**Top Winnings:**
```graphql
query {
  winningss(orderBy: "collateralAmount", orderDirection: "desc", limit: 5) {
    items {
      id
      user
      collateralAmount
      marketQuestion
      timestamp
    }
  }
}
```

**Daily Statistics:**
```graphql
query {
  dailyStatss(orderBy: "id", orderDirection: "desc", limit: 30) {
    items {
      id
      tradesCount
      volume
      winningsPaid
    }
  }
}
```

## Deployment

### Railway

1. Push code to GitHub
2. Create new Railway project from repo
3. Add PostgreSQL database
4. Set environment variables:
   ```
   PONDER_RPC_URL_146=https://rpc.soniclabs.com
   ```
5. Deploy

### Docker

```dockerfile
FROM node:20-alpine

WORKDIR /app
COPY package*.json ./
RUN npm ci --only=production

COPY . .
RUN npm run codegen

EXPOSE 42069
CMD ["npm", "run", "start"]
```

```bash
docker build -t anymarket-indexer .
docker run -p 42069:42069 \
  -e PONDER_RPC_URL_146=https://rpc.soniclabs.com \
  -e DATABASE_URL=postgresql://... \
  anymarket-indexer
```

## Troubleshooting

### Common Issues

| Issue | Cause | Solution |
|-------|-------|----------|
| Slow initial sync | Start block too early | Update `startBlock` in config |
| "Market not found" | Factory events delayed | Wait for factory sync |
| Empty query results | Sync incomplete | Wait for 100% sync |
| RPC rate limiting | Public RPC limits | Use dedicated RPC |

### Reset and Resync

```bash
rm -rf .ponder
npm run dev
```

### Logs

Ponder provides detailed logging:
```
11:41:04 PM INFO  historical Started syncing 'sonic' with 0.0% cached
11:41:38 PM INFO  realtime   Synced block 56719270 from 'sonic'
```

## Performance Tips

1. **Start Block**: Set as close to contract deployment as possible
2. **RPC Provider**: Use dedicated RPC for production (Alchemy, QuickNode)
3. **Database**: PostgreSQL for production, SQLite for development
4. **Caching**: Historical data cached in `.ponder/` directory

## Security

- **Read-only**: Only reads blockchain data, never writes
- **No private keys**: No wallet or signing capabilities
- **Public API**: GraphQL is public by default (add auth middleware if needed)

## Frontend Integration

The Anymarket frontend uses `usePonderStats()` hook to query this indexer:

```typescript
// In src/hooks/usePonderStats.ts
const PONDER_API_URL = 'https://your-indexer.railway.app/graphql';

const { platformStats, leaderboard, recentTrades } = usePonderStats();
```

## Links

- [Ponder Documentation](https://ponder.sh/docs)
- [Sonic Chain Explorer](https://sonicscan.org)
- [Anymarket Frontend](../README.md)
- [Smart Contracts](../prediction-oracle-contracts/README.md)

