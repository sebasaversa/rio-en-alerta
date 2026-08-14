const DEFAULT_RETRYABLE_STATUSES = new Set([408, 425, 429, 500, 502, 503, 504]);

class TelegramApiError extends Error {
  constructor(message, options = {}) {
    super(message, options.cause ? { cause: options.cause } : undefined);
    this.name = 'TelegramApiError';
    this.status = options.status ?? 0;
    this.method = options.method;
    this.retryAfterMs = options.retryAfterMs ?? null;
    this.retryable = options.retryable ?? false;
  }
}

function retryAfterMs(response, result) {
  const telegramSeconds = Number(result?.parameters?.retry_after);
  if (Number.isFinite(telegramSeconds) && telegramSeconds >= 0) {
    return telegramSeconds * 1000;
  }
  const header = response?.headers?.get?.('retry-after');
  if (!header) return null;
  const seconds = Number(header);
  if (Number.isFinite(seconds) && seconds >= 0) return seconds * 1000;
  const date = new Date(header);
  return Number.isNaN(date.getTime()) ? null : Math.max(0, date.getTime() - Date.now());
}

function exponentialDelay(attempt, baseDelayMs, maxDelayMs, jitterRatio, random) {
  const exponential = Math.min(maxDelayMs, baseDelayMs * (2 ** attempt));
  const jitter = exponential * jitterRatio * ((random() * 2) - 1);
  return Math.max(0, Math.round(exponential + jitter));
}

function createTelegramClient(options) {
  const {
    token,
    fetchImpl = fetch,
    sleep = (milliseconds) => new Promise((resolve) => setTimeout(resolve, milliseconds)),
    logger = console,
    maxAttempts = 3,
    baseDelayMs = 500,
    maxDelayMs = 10000,
    maxRetryAfterMs = 30000,
    maxTotalDelayMs = 30000,
    jitterRatio = 0.2,
    random = Math.random,
    requestTimeoutMs = 15000,
    apiBase = 'https://api.telegram.org',
  } = options;

  if (typeof token !== 'function') throw new TypeError('token debe ser una función');
  if (!Number.isInteger(maxAttempts) || maxAttempts < 1) throw new RangeError('maxAttempts debe ser al menos 1');

  async function request(method, body) {
    let lastError;
    let totalDelayMs = 0;
    for (let attempt = 0; attempt < maxAttempts; attempt += 1) {
      try {
        const response = await fetchImpl(`${apiBase}/bot${token()}/${method}`, {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify(body),
          signal: AbortSignal.timeout(requestTimeoutMs),
        });
        const result = await response.json().catch(() => null);
        if (response.ok && result?.ok) return result.result;

        const status = response.status === 200 && Number.isInteger(result?.error_code)
          ? result.error_code
          : response.status;
        const suggestedDelay = retryAfterMs(response, result);
        const retryable = DEFAULT_RETRYABLE_STATUSES.has(status) || (response.ok && !result);
        lastError = new TelegramApiError(
          `Telegram ${method} falló: ${status} ${result?.description ?? ''}`.trim(),
          { status, method, retryAfterMs: suggestedDelay, retryable },
        );
      } catch (error) {
        lastError = error instanceof TelegramApiError
          ? error
          : new TelegramApiError(`Telegram ${method} no respondió: ${error.message}`, {
            cause: error,
            method,
            retryable: true,
          });
      }

      const hasAnotherAttempt = attempt + 1 < maxAttempts;
      if (!lastError.retryable || !hasAnotherAttempt) throw lastError;
      if (lastError.retryAfterMs != null && lastError.retryAfterMs > maxRetryAfterMs) {
        logger.warn('Telegram pidió una espera mayor al presupuesto de reintento', {
          method,
          attempt: attempt + 1,
          retryAfterMs: lastError.retryAfterMs,
        });
        throw lastError;
      }

      const delayMs = lastError.retryAfterMs
        ?? exponentialDelay(attempt, baseDelayMs, maxDelayMs, jitterRatio, random);
      if (totalDelayMs + delayMs > maxTotalDelayMs) {
        logger.warn('Telegram agotó el presupuesto total de reintentos', {
          method,
          attempt: attempt + 1,
          totalDelayMs,
          nextDelayMs: delayMs,
        });
        throw lastError;
      }
      logger.warn('Reintentando llamada a Telegram', {
        method,
        attempt: attempt + 1,
        nextAttempt: attempt + 2,
        status: lastError.status || undefined,
        delayMs,
      });
      await sleep(delayMs);
      totalDelayMs += delayMs;
    }
    throw lastError;
  }

  return { request };
}

module.exports = {
  DEFAULT_RETRYABLE_STATUSES,
  TelegramApiError,
  createTelegramClient,
  exponentialDelay,
  retryAfterMs,
};
