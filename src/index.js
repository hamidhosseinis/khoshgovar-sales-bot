import { publicReply } from './messages.js';

const WEBHOOK_PATH = '/telegram/webhook';
const MAX_BODY_BYTES = 64 * 1024;

function response(message, status = 200) {
  return new Response(message, {
    status,
    headers: { 'content-type': 'text/plain; charset=utf-8', 'cache-control': 'no-store' },
  });
}

// Compare fixed-size SHA-256 digests without early exits or secret-length tests.
async function equalSecret(provided, expected) {
  const enc = new TextEncoder();
  const [a, b] = await Promise.all([
    crypto.subtle.digest('SHA-256', enc.encode(provided)),
    crypto.subtle.digest('SHA-256', enc.encode(expected)),
  ]);
  const left = new Uint8Array(a);
  const right = new Uint8Array(b);
  let diff = 0;
  for (let i = 0; i < left.length; i += 1) diff |= left[i] ^ right[i];
  return diff === 0;
}

async function readJsonBounded(request) {
  if (!request.body) return null;
  const reader = request.body.getReader();
  const chunks = [];
  let length = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    length += value.byteLength;
    if (length > MAX_BODY_BYTES) {
      await reader.cancel();
      throw new RangeError('body_too_large');
    }
    chunks.push(value);
  }
  const bytes = new Uint8Array(length);
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(bytes));
}

async function sendTelegramMessage(botToken, chatId, reply, sendFetch) {
  // Never log the Bot API URL: Telegram bot token appears in the path.
  const apiResponse = await sendFetch('https://api.telegram.org/bot' + botToken + '/sendMessage', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ chat_id: chatId, ...reply }),
  });
  if (!apiResponse.ok) throw new Error('telegram_send_failed');
  const result = await apiResponse.json();
  if (result?.ok !== true) throw new Error('telegram_send_failed');
}

export async function handleRequest(request, env, sendFetch = fetch) {
  const path = new URL(request.url).pathname;
  if (path === '/health' && request.method === 'GET') return response('OK');
  if (path !== WEBHOOK_PATH) return response('Not found', 404);
  if (request.method !== 'POST') return response('Method not allowed', 405);

  // Fail closed when credentials or administrator setup are missing.
  if (!env.TELEGRAM_WEBHOOK_SECRET || !env.TELEGRAM_BOT_TOKEN) {
    return response('Service unavailable', 503);
  }
  const provided = request.headers.get('X-Telegram-Bot-Api-Secret-Token') ?? '';
  if (!(await equalSecret(provided, env.TELEGRAM_WEBHOOK_SECRET))) {
    return response('Unauthorized', 401);
  }
  if (!request.headers.get('content-type')?.toLowerCase().startsWith('application/json')) {
    return response('Unsupported media type', 415);
  }

  let update;
  try {
    update = await readJsonBounded(request);
  } catch (error) {
    return response('Invalid update', error instanceof RangeError ? 413 : 400);
  }

  // Only handle direct chats; no group messages, channel messages, or callbacks.
  // Unknown future Telegram update types are acknowledged but never authorized.
  const message = update?.message;
  if (!message || message.chat?.type !== 'private' ||
      !Number.isSafeInteger(message.chat?.id) ||
      !Number.isSafeInteger(message.from?.id)) return response('OK');

  const reply = publicReply(message, env);
  try {
    await sendTelegramMessage(env.TELEGRAM_BOT_TOKEN, message.chat.id, reply, sendFetch);
    return response('OK');
  } catch {
    // Telegram will retry the webhook; do not log secrets or customer messages.
    return response('Temporary failure', 502);
  }
}

export default {
  async fetch(request, env) {
    return handleRequest(request, env);
  },
};
