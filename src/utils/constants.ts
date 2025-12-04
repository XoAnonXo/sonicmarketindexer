/**
 * Constants and type-safe enums for the Anymarket indexer
 */

// =============================================================================
// TRADE TYPES
// =============================================================================
/**
 * All possible trade types across AMM and PariMutuel markets
 */
export const TradeType = {
  BUY: "buy",
  SELL: "sell",
  SWAP: "swap",
  BET: "bet",
  SEED: "seed",
  LIQUIDITY_IMBALANCE: "liquidity_imbalance",
} as const;

export type TradeTypeValue = (typeof TradeType)[keyof typeof TradeType];

// =============================================================================
// TRADE SIDES
// =============================================================================
/**
 * Possible sides for a trade
 */
export const TradeSide = {
  YES: "yes",
  NO: "no",
  BOTH: "both",
  IMBALANCE: "imbalance",
} as const;

export type TradeSideValue = (typeof TradeSide)[keyof typeof TradeSide];

// =============================================================================
// MARKET TYPES
// =============================================================================
/**
 * Market types: AMM (Automated Market Maker) or PariMutuel
 */
export const MarketType = {
  AMM: "amm",
  PARI: "pari",
} as const;

export type MarketTypeValue = (typeof MarketType)[keyof typeof MarketType];

// =============================================================================
// LIQUIDITY EVENT TYPES
// =============================================================================
/**
 * Liquidity event types for LP operations
 */
export const LiquidityEventType = {
  ADD: "add",
  REMOVE: "remove",
} as const;

export type LiquidityEventTypeValue = (typeof LiquidityEventType)[keyof typeof LiquidityEventType];

// =============================================================================
// POLL STATUS
// =============================================================================
/**
 * Poll resolution status values
 */
export const PollStatus = {
  PENDING: 0,
  YES: 1,
  NO: 2,
  UNKNOWN: 3,
} as const;

export type PollStatusValue = (typeof PollStatus)[keyof typeof PollStatus];

// =============================================================================
// THRESHOLDS
// =============================================================================
/**
 * Minimum trade amount to index (filters dust trades)
 * Value: 0.01 USDC (6 decimals)
 */
export const MIN_TRADE_AMOUNT = 10_000n; // 0.01 USDC

/**
 * Minimum token amount for swap trades
 * Value: 0.001 tokens (18 decimals)
 */
export const MIN_TOKEN_AMOUNT = 1_000_000_000_000_000n; // 0.001 tokens

// =============================================================================
// DEFAULT VALUES
// =============================================================================
/**
 * Zero address placeholder
 */
export const ZERO_ADDRESS = "0x0000000000000000000000000000000000000000" as `0x${string}`;

/**
 * Zero transaction hash placeholder
 */
export const ZERO_TX_HASH = "0x0000000000000000000000000000000000000000000000000000000000000000" as `0x${string}`;
