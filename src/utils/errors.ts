/**
 * Error handling utilities
 */

const DEFAULT_RETRIES = 3;
const BASE_DELAY_MS = 100;

/**
 * Check if an error is non-retryable (permanent failure).
 * These errors won't succeed on retry so we fail fast.
 */
function isNonRetryableError(error: unknown): boolean {
  if (!(error instanceof Error)) return false;
  
  const message = error.message.toLowerCase();
  const errorName = error.name?.toLowerCase() ?? '';
  
  // Database constraint violations
  if (message.includes('unique constraint') || message.includes('p2002')) {
    return true;
  }
  
  // Schema/validation errors
  if (message.includes('invalid') || message.includes('validation')) {
    return true;
  }
  
  // Foreign key violations
  if (message.includes('foreign key') || message.includes('p2003')) {
    return true;
  }
  
  // Null constraint violations
  if (message.includes('null constraint') || message.includes('p2011')) {
    return true;
  }
  
  // Type errors (programming bugs)
  if (errorName === 'typeerror' || errorName === 'syntaxerror') {
    return true;
  }
  
  // Contract revert (on-chain state issue, not transient)
  if (message.includes('execution reverted') || message.includes('revert')) {
    return true;
  }
  
  return false;
}

/**
 * Check if an error is retryable (transient failure).
 * These are typically network/connection issues that may succeed on retry.
 */
function isRetryableError(error: unknown): boolean {
  if (!(error instanceof Error)) return true; // Unknown errors - try anyway
  
  const message = error.message.toLowerCase();
  
  // Network errors
  if (message.includes('timeout') || 
      message.includes('econnrefused') || 
      message.includes('econnreset') ||
      message.includes('socket hang up') ||
      message.includes('network')) {
    return true;
  }
  
  // Rate limiting
  if (message.includes('rate limit') || message.includes('429') || message.includes('too many requests')) {
    return true;
  }
  
  // Temporary unavailable
  if (message.includes('503') || message.includes('502') || message.includes('unavailable')) {
    return true;
  }
  
  // Database connection issues
  if (message.includes('connection') || message.includes('pool')) {
    return true;
  }
  
  // If not explicitly non-retryable, default to retrying
  return !isNonRetryableError(error);
}

/**
 * Retry wrapper for async operations with exponential backoff.
 * 
 * Automatically skips retries for permanent errors (constraint violations, etc.)
 * while retrying transient errors (network issues, rate limits).
 */
export async function withRetry<T>(
  fn: () => Promise<T>,
  retries = DEFAULT_RETRIES,
  delayMs = BASE_DELAY_MS
): Promise<T> {
  let lastError: unknown;
  
  for (let attempt = 0; attempt <= retries; attempt++) {
    try {
      return await fn();
    } catch (error: unknown) {
      lastError = error;
      
      // Don't retry non-retryable errors
      if (isNonRetryableError(error)) {
        const errorMessage = error instanceof Error ? error.message : String(error);
        console.error(`Non-retryable error, failing immediately: ${errorMessage}`);
        throw error;
      }
      
      // Don't retry on last attempt
      if (attempt < retries && isRetryableError(error)) {
        const sleepTime = delayMs * Math.pow(2, attempt);
        const errorMessage = error instanceof Error ? error.message : String(error);
        console.warn(`Retryable error, retrying in ${sleepTime}ms (Attempt ${attempt + 1}/${retries}). Error: ${errorMessage}`);
        await new Promise((resolve) => setTimeout(resolve, sleepTime));
      } else if (attempt < retries) {
        // Unknown error type on non-final attempt - log but still retry
        const sleepTime = delayMs * Math.pow(2, attempt);
        const errorMessage = error instanceof Error ? error.message : String(error);
        console.warn(`Unknown error type, retrying in ${sleepTime}ms (Attempt ${attempt + 1}/${retries}). Error: ${errorMessage}`);
        await new Promise((resolve) => setTimeout(resolve, sleepTime));
      }
    }
  }
  
  throw lastError;
}
