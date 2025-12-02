/**
 * PredictionPariMutuel ABI
 * 
 * Pari-mutuel betting market for predictions.
 * All bets are pooled and winners share the losing pool proportionally.
 * Uses dynamic odds based on betting activity.
 * 
 * Key Events:
 * - PositionPurchased: When a user places a bet
 * - WinningsRedeemed: When a winner claims their payout
 */

export const PredictionPariMutuelAbi = [
  // Betting Event
  {
    type: "event",
    name: "PositionPurchased",
    inputs: [
      { name: "buyer", type: "address", indexed: true },
      { name: "isYes", type: "bool", indexed: true },
      { name: "collateralIn", type: "uint256", indexed: false },
      { name: "sharesOut", type: "uint256", indexed: false },
    ],
  },

  // Resolution Event
  {
    type: "event",
    name: "WinningsRedeemed",
    inputs: [
      { name: "user", type: "address", indexed: true },
      { name: "collateralAmount", type: "uint256", indexed: false },
      { name: "outcome", type: "uint8", indexed: false },
      { name: "fee", type: "uint256", indexed: false },
    ],
  },

  // View function for poll address (factory pattern)
  {
    type: "function",
    name: "pollAddress",
    inputs: [],
    outputs: [{ name: "", type: "address" }],
    stateMutability: "view",
  },

  // Market info
  {
    type: "function",
    name: "getMarketInfo",
    inputs: [],
    outputs: [
      {
        components: [
          { name: "creator", type: "address" },
          { name: "pollAddress", type: "address" },
          { name: "collateralToken", type: "address" },
          { name: "protocolFeeRate", type: "uint24" },
          { name: "marketCloseTimestamp", type: "uint32" },
          { name: "marketStartTimestamp", type: "uint32" },
        ],
        type: "tuple",
      },
    ],
    stateMutability: "view",
  },
] as const;

