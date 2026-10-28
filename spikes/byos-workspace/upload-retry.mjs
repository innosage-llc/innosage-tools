// One retry coordinator owns this policy; native helper retry loops must not be
// stacked around these attempts. Historical experiments keep their old policy.
export const UPLOAD_RETRY_POLICY = Object.freeze({maxAttempts: 3, baseMs: 500, maxBackoffMs: 4000});
const rateReasons = new Set(['rateLimitExceeded', 'userRateLimitExceeded', 'sharingRateLimitExceeded']);
const permanentReasons = new Set(['storageQuotaExceeded', 'dailyLimitExceeded', 'insufficientPermissions', 'forbidden', 'accessNotConfigured', 'invalidParameter', 'badRequest']);
export function classifyUploadError({status, reason, network = false, ambiguous = false, offline = false, write = false} = {}) {
  if (offline) return {state: 'pending', category: 'offline', retry: false, reconcile: write && ambiguous};
  if (status === 401) return {state: 'auth-required', category: 'authentication', retry: false, reconcile: false};
  if (status === 412) return {state: 'conflict', category: 'conditional-write', retry: false, reconcile: write};
  if (permanentReasons.has(reason)) return {state: 'failed', category: reason, retry: false, reconcile: write && ambiguous};
  if (status === 403 && !rateReasons.has(reason)) return {state: 'failed', category: 'permission-or-configuration', retry: false, reconcile: write && ambiguous};
  if (network || ambiguous || status === 429 || rateReasons.has(reason) || [500, 502, 503, 504].includes(status))
    return {state: 'retrying', category: network || ambiguous ? 'transport-uncertain' : status >= 500 ? 'temporary-service' : 'rate-limit', retry: true, reconcile: write};
  return {state: 'failed', category: 'non-retryable', retry: false, reconcile: write && ambiguous};
}
export function retryDelay({attempt, retryAfter, nowMs, wallNowMs = Date.now(), random = 0.5, remainingMs, policy = UPLOAD_RETRY_POLICY}) {
  if (!Number.isInteger(attempt) || attempt < 1 || attempt >= policy.maxAttempts) return {stop: 'ATTEMPT_BUDGET_EXHAUSTED'};
  const exponential = Math.min(policy.maxBackoffMs, policy.baseMs * 2 ** (attempt - 1));
  const jittered = Math.round(exponential * (0.8 + 0.4 * Math.max(0, Math.min(1, random))));
  let serverMs = 0;
  if (typeof retryAfter === 'string' && retryAfter.trim()) {
    const seconds = Number(retryAfter);
    if (Number.isFinite(seconds) && seconds >= 0) serverMs = seconds * 1000;
    else { const date = Date.parse(retryAfter); if (Number.isFinite(date)) serverMs = Math.max(0, date - wallNowMs); }
  }
  const delayMs = Math.max(jittered, serverMs);
  if (!Number.isFinite(remainingMs) || delayMs >= remainingMs) return {stop: 'TIME_BUDGET_EXHAUSTED'};
  return {delayMs, serverDelayMs: serverMs, nextAttempt: attempt + 1, nextAtMs: nowMs + delayMs};
}
