import { getChainName } from "../../config";
import type { PonderContext, ChainInfo } from "./types";

// Re-export ChainInfo for backward compatibility
export type { ChainInfo } from "./types";

/**
 * Extract chain information from Ponder event context.
 */
export function getChainInfo(context: PonderContext): ChainInfo {
  const chainId = context.network.chainId;
  const chainName = getChainName(chainId);
  return { chainId, chainName };
}

/**
 * Generate a composite ID string for records that need chain-scoping.
 */
export function makeId(chainId: number, ...parts: (string | number | bigint)[]): string {
  return [chainId, ...parts].join("-");
}

/**
 * Calculate the day boundary timestamp (midnight UTC) for a given timestamp.
 */
export function getDayTimestamp(timestamp: bigint): bigint {
  const day = Number(timestamp) - (Number(timestamp) % 86400);
  return BigInt(day);
}

/**
 * Calculate the hour boundary timestamp for a given timestamp.
 */
export function getHourTimestamp(timestamp: bigint): bigint {
  const hour = Number(timestamp) - (Number(timestamp) % 3600);
  return BigInt(hour);
}
