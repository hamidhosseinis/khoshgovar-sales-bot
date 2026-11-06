/**
 * Cron-backed, idempotent registration. No public setup endpoint is exposed.
 * Telegram token is read only from the Worker Secret binding.
 */
export const PUBLIC_WEBHOOK_URL =
  'https://khoshgovar-sales-bot.mahale-market-kordkuy.workers.dev/telegram/webhook';

async function configurationFingerprint(env) {
  const data = new TextEncoder().encode([
    PUBLIC_WEBHOOK_URL, env.TELEGRAM_BOT_TOKEN, env.TELEGRAM_WEBHOOK_SECRET
  ].join('\n'));
  const sha = new Uint8Array(await crypto.subtle.digest('SHA-256', data));
  return Array.from(sha, x => x.toString(16).padStart(2, '0')).join('');
}

export async function syncTelegramWebhook(env, sendFetch = fetch) {
  if (!env?.CART_DB?.prepare || !env?.TELEGRAM_BOT_TOKEN || !env?.TELEGRAM_WEBHOOK_SECRET) {
    return 'not_configured';
  }
  if (!/^[A-Za-z0-9_-]{1,256}$/.test(env.TELEGRAM_WEBHOOK_SECRET)) {
    return 'invalid_secret';
  }
  try {
    const fingerprint = await configurationFingerprint(env);
    const row = await env.CART_DB
      .prepare('SELECT value FROM bot_runtime WHERE key=?')
      .bind('registered_webhook_fingerprint').first();

    if (row?.value === fingerprint) return 'already_registered';
    // Avoid logging the Bot API URL, token, request headers, or response body.
    const endpoint = 'https://api.telegram.org/bot' + env.TELEGRAM_BOT_TOKEN + '/setWebhook';
    const response = await sendFetch(endpoint, {
      method: 'POST',
      headers: {'content-type': 'application/json'},
      body: JSON.stringify({
        url: PUBLIC_WEBHOOK_URL,
        secret_token: env.TELEGRAM_WEBHOOK_SECRET,
        allowed_updates: ['message'],
        drop_pending_updates: false
      })
    });
    if (!response.ok) return 'telegram_request_failed';
    const body = await response.json();
    if (body?.ok !== true || body?.result !== true) return 'telegram_request_failed';

    await env.CART_DB.prepare(
      'INSERT INTO bot_runtime (key,value) VALUES (?,?) ' +
      'ON CONFLICT(key) DO UPDATE SET value=excluded.value'
    ).bind('registered_webhook_fingerprint', fingerprint).run();
    return 'registered';
  } catch {
    // Fail closed. Retry on the next scheduled invocation without logging secrets.
    return 'temporary_failure';
  }
}
