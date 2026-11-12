import { publicReply, isAuthorizedOwner } from './messages.js';
import { botReply } from './bot.js';
import { card } from './bot-ui.js';
import { consultationReply, isConsultationRequest } from './consultation.js';
import { syncTelegramWebhook } from './telegram-webhook-sync.js';

const WEBHOOK_PATH = '/telegram/webhook';
const MAX_BODY_BYTES = 64 * 1024;

// A legacy ReplyKeyboardMarkup can survive client updates. Remove it when
// the customer sends a command or taps an old bottom-keyboard text button.
// Inline callbacks never trigger a second message or an extra keyboard.
const LEGACY_REPLY_BUTTONS = new Set([
  '📦 محصولات', '🏷 طرح‌های فروش', '🏷 طرح‌های عمومی',
  '💰 لیست قیمت', '💰 قیمت‌ها', '🔎 جستجوی محصول', '🔎 جستجو',
  '🧮 محاسبه قیمت', '🛒 سبد خرید', 'ℹ️ راهنما', '💬 مشاوره',
]);
const mustClearReplyKeyboard = content =>
  content.startsWith('/') || LEGACY_REPLY_BUTTONS.has(content);

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

async function telegramCall(botToken, method, payload, sendFetch) {
  // Never log Telegram URLs or bodies: the bot token is embedded in the URL.
  const res = await sendFetch('https://api.telegram.org/bot' + botToken + '/' + method, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(payload),
  });
  let body;
  try { body = await res.json(); } catch { throw new Error('telegram_invalid_response'); }
  if (res.ok && body?.ok === true) return method === 'sendMessage' ? (body.result?.message_id ?? 'ok') : 'ok';
  if (method === 'editMessageText' && res.status === 400) {
    if (/message is not modified/i.test(body?.description || '')) return 'unchanged';
    if (/message (can't be edited|to edit not found)/i.test(body?.description || '')) return 'cannot_edit';
  }
  throw new Error('telegram_api_failed');
}
async function sendTelegramMessage(botToken, chatId, reply, sendFetch) {
  return telegramCall(botToken, 'sendMessage',
    { chat_id: chatId, ...reply, text: String(reply.text).slice(0, 3900) }, sendFetch);
}
async function editTelegramMessage(botToken, chatId, messageId, reply, sendFetch) {
  const result = await telegramCall(botToken, 'editMessageText',
    { chat_id: chatId, message_id: messageId, ...reply, text: String(reply.text).slice(0, 3900) },
    sendFetch);
  if (result === 'cannot_edit') await sendTelegramMessage(botToken, chatId, reply, sendFetch);
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

  // Only private chats are eligible. A callback must belong to the same
  // private user; never process buttons from groups or other users.
  const callback = update?.callback_query;
  const message = callback?.message || update?.message;
  const user = callback?.from || message?.from;
  if (!message || message.chat?.type !== 'private' ||
      !Number.isSafeInteger(message.chat?.id) ||
      !Number.isSafeInteger(user?.id) ||
      message.chat.id !== user.id) return response('OK');

  // Owner-only mode: do not answer callbacks, fetch Sheets, or send messages
  // for other users. If the owner ID is not set, all updates are ignored.
  if (!isAuthorizedOwner(user, env)) return response('OK');

  try {
    const content = callback?.data || (typeof message.text === 'string' ? message.text.trim() : '');
    if (callback) {
      if (typeof callback.id !== 'string' || !Number.isSafeInteger(message.message_id))
        return response('OK');
      // Stop Telegram's loading indicator promptly, before fetching Sheets.
      await telegramCall(env.TELEGRAM_BOT_TOKEN, 'answerCallbackQuery',
        { callback_query_id: callback.id }, sendFetch);
    }
    // Consultation stays reachable even if the Sheets or D1 integration fails.
    const reply = isConsultationRequest(content)
      ? consultationReply()
      : (env.GOOGLE_SERVICE_ACCOUNT_JSON && env.SALES_SPREADSHEET_ID)
        ? await botReply(update, env, sendFetch)
        : callback ? card('اطلاعات عمومی بات فعلاً در دسترس نیست.') : publicReply(message, env);
    if (!reply) return response('OK');
    if (callback) {
      await editTelegramMessage(env.TELEGRAM_BOT_TOKEN, message.chat.id,
        message.message_id, reply, sendFetch);
    } else if (mustClearReplyKeyboard(content)) {
      // Telegram cannot combine remove_keyboard with inline_keyboard in one send.
      // Clear any lingering bottom keyboard, then turn the same message into
      // the requested inline screen. Ordinary search text stays single-message.
      const messageId = await sendTelegramMessage(env.TELEGRAM_BOT_TOKEN, message.chat.id, {
        text: '🥤 منوی فروش خوشگوار',
        reply_markup: { remove_keyboard: true },
      }, sendFetch);
      if (Number.isSafeInteger(messageId)) {
        await editTelegramMessage(env.TELEGRAM_BOT_TOKEN, message.chat.id, messageId, reply, sendFetch);
      } else {
        await sendTelegramMessage(env.TELEGRAM_BOT_TOKEN, message.chat.id, reply, sendFetch);
      }
    } else {
      await sendTelegramMessage(env.TELEGRAM_BOT_TOKEN, message.chat.id, reply, sendFetch);
    }
    return response('OK');
  } catch {
    // Telegram can retry failed updates; never log credentials or message text.
    return response('Temporary failure', 502);
  }
}

export default {
  async fetch(request, env) {
    return handleRequest(request, env);
  },
  async scheduled(_controller, env) {
    await syncTelegramWebhook(env);
  },
};
