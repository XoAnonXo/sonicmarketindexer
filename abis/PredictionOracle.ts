/**
 * PredictionOracle ABI
 * 
 * Contract responsible for creating and managing prediction polls.
 * Polls are yes/no questions that can be resolved by operators.
 * 
 * Key Events:
 * - PollCreated: When a new poll is created
 * - PollRefreshed: When a poll's check epoch is updated
 */

export const PredictionOracleAbi = [
  // Events (indexed)
  {
    anonymous: false,
    inputs: [
      { indexed: true, name: "pollAddress", type: "address" },
      { indexed: true, name: "creator", type: "address" },
      { indexed: false, name: "deadlineEpoch", type: "uint32" },
      { indexed: false, name: "question", type: "string" },
    ],
    name: "PollCreated",
    type: "event",
  },
  {
    anonymous: false,
    inputs: [
      { indexed: true, name: "pollAddress", type: "address" },
      { indexed: false, name: "oldCheckEpoch", type: "uint32" },
      { indexed: false, name: "newCheckEpoch", type: "uint32" },
      { indexed: false, name: "wasFree", type: "bool" },
    ],
    name: "PollRefreshed",
    type: "event",
  },
  {
    anonymous: false,
    inputs: [{ indexed: true, name: "operator", type: "address" }],
    name: "OperatorAdded",
    type: "event",
  },
  {
    anonymous: false,
    inputs: [{ indexed: true, name: "operator", type: "address" }],
    name: "OperatorRemoved",
    type: "event",
  },
] as const;

