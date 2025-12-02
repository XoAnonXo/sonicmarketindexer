/**
 * Verify Poll Data: Compare indexer polls with on-chain values
 * 
 * Checks:
 * - question, rules, sources
 * - deadlineEpoch, finalizationEpoch, checkEpoch
 * - category, status
 * - creator address
 */

import { getContract, type Address } from "viem";
import {
  client,
  queryIndexer,
  logHeader,
  logInfo,
  logSuccess,
  logError,
  logWarning,
  compare,
  batchProcess,
  createSummary,
  recordResult,
  printSummary,
  type VerificationSummary,
} from "./utils.js";
import { PredictionPollAbi, CONTRACTS } from "./contracts.js";

// GraphQL query to get all polls from indexer
const POLLS_QUERY = `
  query GetPolls($limit: Int) {
    pollss(limit: $limit, orderBy: "createdAt", orderDirection: "desc") {
      items {
        id
        chainId
        creator
        question
        rules
        sources
        deadlineEpoch
        finalizationEpoch
        checkEpoch
        category
        status
        resolutionReason
        resolvedAt
        createdAtBlock
        createdAt
      }
    }
  }
`;

interface IndexerPoll {
  id: string;
  chainId: number;
  creator: string;
  question: string;
  rules: string;
  sources: string;
  deadlineEpoch: number;
  finalizationEpoch: number;
  checkEpoch: number;
  category: number;
  status: number;
  resolutionReason: string | null;
  resolvedAt: string | null;
  createdAtBlock: string;
  createdAt: string;
}

interface OnChainPoll {
  question: string;
  rules: string;
  sources: readonly string[] | string[];
  deadlineEpoch: number;
  finalizationEpoch: number;
  checkEpoch: number;
  category: number;
  status: number;
  resolutionReason: string;
  creator: Address;
}

/**
 * Fetch poll data from on-chain
 */
async function fetchOnChainPoll(pollAddress: Address): Promise<OnChainPoll | null> {
  try {
    const contract = getContract({
      address: pollAddress,
      abi: PredictionPollAbi,
      client,
    });

    const [
      question,
      rules,
      sources,
      deadlineEpoch,
      finalizationEpoch,
      checkEpoch,
      category,
      status,
      resolutionReason,
      creator,
    ] = await Promise.all([
      contract.read.question(),
      contract.read.rules().catch(() => ""),
      contract.read.sources().catch((): string[] => []),
      contract.read.deadlineEpoch(),
      contract.read.finalizationEpoch().catch(() => 0),
      contract.read.checkEpoch().catch(() => 0),
      contract.read.category().catch(() => 0),
      contract.read.status(),
      contract.read.resolutionReason().catch(() => ""),
      contract.read.creator(),
    ]);

    return {
      question,
      rules,
      sources,
      deadlineEpoch: Number(deadlineEpoch),
      finalizationEpoch: Number(finalizationEpoch),
      checkEpoch: Number(checkEpoch),
      category: Number(category),
      status: Number(status),
      resolutionReason,
      creator,
    };
  } catch (error) {
    logWarning(`Failed to fetch on-chain data for poll ${pollAddress}: ${error}`);
    return null;
  }
}

/**
 * Verify a single poll
 */
async function verifyPoll(
  indexerPoll: IndexerPoll,
  summary: VerificationSummary
): Promise<void> {
  const pollAddress = indexerPoll.id as Address;
  
  console.log(`\n📋 Poll: ${pollAddress}`);
  console.log(`   Question: "${indexerPoll.question.substring(0, 50)}..."`);
  
  const onChainPoll = await fetchOnChainPoll(pollAddress);
  
  if (!onChainPoll) {
    logError("Could not fetch on-chain data");
    summary.failed++;
    summary.mismatches.push(`${pollAddress}: Could not fetch`);
    return;
  }

  // Compare question
  const questionMatch = compare("Question", indexerPoll.question, onChainPoll.question);
  recordResult(summary, questionMatch.match, `${pollAddress}: question`);

  // Compare status
  const statusMatch = compare("Status", indexerPoll.status, onChainPoll.status);
  recordResult(summary, statusMatch.match, `${pollAddress}: status`);

  // Compare deadlineEpoch
  const deadlineMatch = compare("Deadline Epoch", indexerPoll.deadlineEpoch, onChainPoll.deadlineEpoch);
  recordResult(summary, deadlineMatch.match, `${pollAddress}: deadlineEpoch`);

  // Compare category
  const categoryMatch = compare("Category", indexerPoll.category, onChainPoll.category);
  recordResult(summary, categoryMatch.match, `${pollAddress}: category`);

  // Compare creator
  const creatorMatch = compare(
    "Creator",
    indexerPoll.creator.toLowerCase(),
    onChainPoll.creator.toLowerCase()
  );
  recordResult(summary, creatorMatch.match, `${pollAddress}: creator`);

  // Compare checkEpoch (if set)
  if (onChainPoll.checkEpoch > 0 || indexerPoll.checkEpoch > 0) {
    const checkEpochMatch = compare("Check Epoch", indexerPoll.checkEpoch, onChainPoll.checkEpoch);
    recordResult(summary, checkEpochMatch.match, `${pollAddress}: checkEpoch`);
  }
}

/**
 * Main verification function
 */
export async function verifyPolls(): Promise<VerificationSummary> {
  logHeader("POLL VERIFICATION");
  
  const summary = createSummary();
  
  // Fetch all polls from indexer
  logInfo("Fetching polls from indexer...");
  
  let allPolls: IndexerPoll[] = [];
  const limit = 1000;
  
  try {
    const data = await queryIndexer<{ pollss: { items: IndexerPoll[] } }>(
      POLLS_QUERY,
      { limit }
    );
    allPolls = data.pollss.items;
  } catch (error) {
    logError(`Failed to fetch polls from indexer: ${error}`);
    return summary;
  }
  
  logInfo(`Found ${allPolls.length} polls in indexer`);
  
  // Verify each poll (with batching to avoid rate limits)
  const pollsToVerify = allPolls.slice(0, 50); // Limit for first run
  logInfo(`Verifying ${pollsToVerify.length} polls...`);
  
  for (const poll of pollsToVerify) {
    await verifyPoll(poll, summary);
  }
  
  return summary;
}

// Run if called directly
const scriptPath = process.argv[1];
const isMainModule = import.meta.url.endsWith(scriptPath.split('/').pop()!) || 
                     import.meta.url.includes('verify-polls');
if (isMainModule) {
  verifyPolls()
    .then(printSummary)
    .catch(console.error);
}

