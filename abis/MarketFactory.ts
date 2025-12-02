/**
 * MarketFactory ABI
 * 
 * Factory contract for creating AMM and PariMutuel prediction markets.
 * Markets are linked to polls and handle all trading/betting activity.
 * 
 * Key Events:
 * - MarketCreated: When an AMM market is deployed
 * - PariMutuelCreated: When a PariMutuel market is deployed
 */

export const MarketFactoryAbi = [
  // Events (indexed for factory pattern)
  {
    anonymous: false,
    inputs: [
      { indexed: true, name: "pollAddress", type: "address" },
      { indexed: true, name: "marketAddress", type: "address" },
      { indexed: true, name: "creator", type: "address" },
      { indexed: false, name: "yesToken", type: "address" },
      { indexed: false, name: "noToken", type: "address" },
      { indexed: false, name: "collateral", type: "address" },
      { indexed: false, name: "feeTier", type: "uint24" },
      { indexed: false, name: "maxPriceImbalancePerHour", type: "uint24" },
    ],
    name: "MarketCreated",
    type: "event",
  },
  {
    anonymous: false,
    inputs: [
      { indexed: true, name: "pollAddress", type: "address" },
      { indexed: true, name: "marketAddress", type: "address" },
      { indexed: true, name: "creator", type: "address" },
      { indexed: false, name: "collateral", type: "address" },
      { indexed: false, name: "curveFlattener", type: "uint8" },
      { indexed: false, name: "curveOffset", type: "uint24" },
    ],
    name: "PariMutuelCreated",
    type: "event",
  },
  {
    anonymous: false,
    inputs: [
      { indexed: true, name: "collateral", type: "address" },
      { indexed: false, name: "whitelisted", type: "bool" },
    ],
    name: "CollateralWhitelisted",
    type: "event",
  },
] as const;

