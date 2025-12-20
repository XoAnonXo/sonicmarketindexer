/**
 * ╔═══════════════════════════════════════════════════════════════════════════╗
 * ║                       PREDICTION POLL ABI                                  ║
 * ╠═══════════════════════════════════════════════════════════════════════════╣
 * ║  Individual poll contract - deployed dynamically by PredictionOracle.      ║
 * ║  Each poll represents a single yes/no prediction question.                 ║
 * ║  Resolution determines which side wins and triggers market settlement.     ║
 * ╚═══════════════════════════════════════════════════════════════════════════╝
 * 
 * POLL STATUS VALUES:
 * ───────────────────
 *   0 = Pending   - Poll is active, not yet resolved
 *   1 = Yes       - Poll resolved to YES outcome
 *   2 = No        - Poll resolved to NO outcome  
 *   3 = Unknown   - Poll resolved as invalid/voided (refund scenario)
 * 
 * RESOLUTION FLOW:
 * ────────────────
 * 1. Poll created (status = 0 Pending)
 * 2. Users trade on linked markets
 * 3. Deadline passes (betting closes)
 * 4. Finalization period (24 hours for disputes)
 * 5. Operator calls setAnswer() → AnswerSet event
 * 6. Users can redeem winnings from linked markets
 * 
 * IMPORTANT FOR INDEXER:
 * ──────────────────────
 * - This is a DYNAMIC contract (many instances, one per poll)
 * - Ponder discovers these via PollCreated factory event
 * - AnswerSet triggers poll status update and enables winnings redemption
 */

export const PredictionPollAbi = [
  // ═══════════════════════════════════════════════════════════════════════════
  // RESOLUTION EVENTS
  // ═══════════════════════════════════════════════════════════════════════════
  
  /**
   * AnswerSet - CRITICAL EVENT: Poll resolution
   * 
   * Emitted when an operator sets the final outcome of a poll.
   * This determines which side (YES/NO) wins in linked markets.
   * 
   * After this event:
   * - Poll status changes from Pending (0) to resolved (1/2/3)
   * - Winners can call WinningsRedeemed on linked markets
   * - 24-hour finalization period must pass before redemptions
   * 
   * @param status - Final poll status: 1=Yes, 2=No, 3=Unknown (uint8)
   * @param setter - Operator who resolved the poll (indexed)
   * @param reason - Human-readable resolution explanation (string)
   * 
   * @example
   * // status = 1: YES wins, NO token holders lose
   * // status = 2: NO wins, YES token holders lose
   * // status = 3: Market voided, proportional refunds
   */
  {
    type: "event",
    name: "AnswerSet",
    inputs: [
      { name: "status", type: "uint8", indexed: false },
      { name: "setter", type: "address", indexed: true },
      { name: "reason", type: "string", indexed: false },
    ],
  },

  // ═══════════════════════════════════════════════════════════════════════════
  // DISPUTE EVENTS (Not currently indexed, but included for reference)
  // ═══════════════════════════════════════════════════════════════════════════
  
  /**
   * ArbitrationStarted - Dispute mechanism triggered
   * 
   * Users can dispute a poll resolution by staking tokens.
   * This pauses winnings redemption until dispute is resolved.
   * 
   * @param requester - User who started arbitration (indexed)
   * @param reason - Explanation for the dispute (string)
   * @param stake - Amount staked for the dispute (uint256)
   */
  {
    type: "event",
    name: "ArbitrationStarted",
    inputs: [
      { name: "requester", type: "address", indexed: true },
      { name: "reason", type: "string", indexed: false },
      { name: "stake", type: "uint256", indexed: false },
    ],
  },

  // ═══════════════════════════════════════════════════════════════════════════
  // VIEW FUNCTIONS
  // ═══════════════════════════════════════════════════════════════════════════
  
  /**
   * question() - Returns the poll's prediction question
   */
  {
    type: "function",
    name: "question",
    inputs: [],
    outputs: [{ name: "", type: "string" }],
    stateMutability: "view",
  },
  
  /**
   * rules() - Returns the poll's resolution rules
   */
  {
    type: "function",
    name: "rules",
    inputs: [],
    outputs: [{ name: "", type: "string" }],
    stateMutability: "view",
  },
  
  /**
   * sources() - Returns array of source URLs for verification
   */
  {
    type: "function",
    name: "sources",
    inputs: [],
    outputs: [{ name: "", type: "string[]" }],
    stateMutability: "view",
  },
  
  /**
   * deadlineEpoch() - Returns the deadline timestamp for betting
   */
  {
    type: "function",
    name: "deadlineEpoch",
    inputs: [],
    outputs: [{ name: "", type: "uint32" }],
    stateMutability: "view",
  },
  
  /**
   * finalizationEpoch() - Returns when the poll can be finalized
   */
  {
    type: "function",
    name: "finalizationEpoch",
    inputs: [],
    outputs: [{ name: "", type: "uint32" }],
    stateMutability: "view",
  },
  
  /**
   * checkEpoch() - Returns when operators should check for resolution
   */
  {
    type: "function",
    name: "checkEpoch",
    inputs: [],
    outputs: [{ name: "", type: "uint32" }],
    stateMutability: "view",
  },
  
  /**
   * category() - Returns the poll category (0-11)
   * Categories: Politics, Sports, Crypto, etc.
   */
  {
    type: "function",
    name: "category",
    inputs: [],
    outputs: [{ name: "", type: "uint8" }],
    stateMutability: "view",
  },
  
  /**
   * status() - Returns the poll status
   * 0=Pending, 1=Yes, 2=No, 3=Unknown
   */
  {
    type: "function",
    name: "status",
    inputs: [],
    outputs: [{ name: "", type: "uint8" }],
    stateMutability: "view",
  },
  
  /**
   * resolutionReason() - Returns the resolution explanation
   */
  {
    type: "function",
    name: "resolutionReason",
    inputs: [],
    outputs: [{ name: "", type: "string" }],
    stateMutability: "view",
  },
  
  /**
   * creator() - Returns the poll creator address
   */
  {
    type: "function",
    name: "creator",
    inputs: [],
    outputs: [{ name: "", type: "address" }],
    stateMutability: "view",
  },
] as const;

