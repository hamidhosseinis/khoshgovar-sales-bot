import test from 'node:test';
import assert from 'node:assert/strict';
import { handleRequest } from '../src/index.js';

const env = {
  TELEGRAM_BOT_TOKEN: 'TEST_ONLY_NOT_REAL',
  TELEGRAM_WEBHOOK_SECRET: 'TEST_ONLY_WEBHOOK_SECRET',
};
const url = 'https://example.workers.dev/telegram/webhook';
function update(text = '/start', userId = 123, chatType = 'private') {
  return { update_id: 1, message: {
    from: { id: userId },
    chat: { id: userId, type: chatType },
    text,
  } };
}
function makeRequest(data = update(), options = {}) {
  return new Request(url, {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      'X-Telegram-Bot-Api-Secret-Token': env.TELEGRAM_WEBHOOK_SECRET,
      ...options.headers,
    },
    body: options.body ?? JSON.stringify(data),
  });
}
function fakeSender() {
  const calls = [];
  const fetchMock = async (endpoint, init) => {
    calls.push({ endpoint, data: JSON.parse(init.body) });
    return new Response(JSON.stringify({ ok: true }), { headers: { 'content-type': 'application/json' } });
  };
  return { calls, fetchMock };
}

test('health does not reveal credentials', async () => {
  const res = await handleRequest(new Request('https://example.workers.dev/health'), env);
  assert.equal(res.status, 200);
  assert.equal(await res.text(), 'OK');
});
test('rejects requests without a valid webhook secret', async () => {
  let sent = false;
  const req = makeRequest(update(), { headers: { 'X-Telegram-Bot-Api-Secret-Token': 'invalid' } });
  const res = await handleRequest(req, env, async () => { sent = true; });
  assert.equal(res.status, 401);
  assert.equal(sent, false);
});
test('fails closed when secret or bot token is absent', async () => {
  const res = await handleRequest(makeRequest(), { TELEGRAM_BOT_TOKEN: env.TELEGRAM_BOT_TOKEN });
  assert.equal(res.status, 503);
});
test('public start message advertises approved products without automatic pricing', async () => {
  const { calls, fetchMock } = fakeSender();
  const res = await handleRequest(makeRequest(), env, fetchMock);
  assert.equal(res.status, 200);
  assert.equal(calls.length, 1);
  assert.match(calls[0].data.text, /نوشابه نوستالژیک/);
  assert.match(calls[0].data.text, /محاسبه خودکار قیمت فعال نیست/);
  assert.ok(calls[0].data.reply_markup.keyboard.length > 0);
});
test('pricing menu denies calculations when unit basis is unknown', async () => {
  const { calls, fetchMock } = fakeSender();
  await handleRequest(makeRequest(update('🧮 محاسبه قیمت')), env, fetchMock);
  assert.match(calls[0].data.text, /محاسبه خودکار یا مبلغ سفارش انجام نمی‌شود/);
});
test('admin command denied without explicit administrator ID', async () => {
  const { calls, fetchMock } = fakeSender();
  await handleRequest(makeRequest(update('/admin')), env, fetchMock);
  assert.equal(calls[0].data.text, 'این بخش در دسترس نیست.');
});
test('admin command denied for another user even if an administrator exists', async () => {
  const { calls, fetchMock } = fakeSender();
  await handleRequest(makeRequest(update('/admin', 123)), { ...env, ADMIN_TELEGRAM_USER_ID: '444' }, fetchMock);
  assert.equal(calls[0].data.text, 'این بخش در دسترس نیست.');
});
test('admin command only acknowledges admin for verified private ID; no admin operations', async () => {
  const { calls, fetchMock } = fakeSender();
  await handleRequest(makeRequest(update('/admin', 123)), { ...env, ADMIN_TELEGRAM_USER_ID: '123' }, fetchMock);
  assert.match(calls[0].data.text, /امکانات مدیریت هنوز فعال نشده‌اند/);
});
test('group messages and callbacks are ignored', async () => {
  const { calls, fetchMock } = fakeSender();
  await handleRequest(makeRequest(update('/admin', 123, 'group')), env, fetchMock);
  await handleRequest(makeRequest({ callback_query: { from: { id: 123 }, data: 'admin' } }), env, fetchMock);
  assert.equal(calls.length, 0);
});
test('payload over limit is rejected', async () => {
  const { calls, fetchMock } = fakeSender();
  const req = makeRequest({}, { body: JSON.stringify({ more: 'a'.repeat(65536) }) });
  const res = await handleRequest(req, env, fetchMock);
  assert.equal(res.status, 413);
  assert.equal(calls.length, 0);
});
test('unexpected route and method are rejected', async () => {
  assert.equal((await handleRequest(new Request('https://example.workers.dev/private'), env)).status, 404);
  assert.equal((await handleRequest(new Request(url), env)).status, 405);
});
test('Telegram delivery errors are not reflected in response details', async () => {
  const failedSender = async () => new Response('secret upstream details', { status: 500 });
  const res = await handleRequest(makeRequest(), env, failedSender);
  assert.equal(res.status, 502);
  assert.doesNotMatch(await res.text(), /secret/);
});

test('public product menu shows only explicitly approved product details and image link', async () => {
  const { calls, fetchMock } = fakeSender();
  await handleRequest(makeRequest(update('📦 محصولات')), env, fetchMock);
  const text = calls[0].data.text;
  assert.match(text, /نوشابه نوستالژیک|کوکاکولا|فانتا پرتقالی/);
  assert.match(text, /۸۰۰[٬,]۰۰۰/);
  assert.match(text, /drive.google.com\/file\/d\/1R597QVAJoAsNfrNj_-Bm1JoGYvBhSKEV\/view/);
  assert.match(text, /مبنای واحد مبلغ/);
  assert.doesNotMatch(text, /data\/drafts|source|approval_status|internal/);
});

test('public plans preserve approved amounts without deriving prices or order totals', async () => {
  const { calls, fetchMock } = fakeSender();
  await handleRequest(makeRequest(update('🏷 طرح‌های عمومی')), env, fetchMock);
  const text = calls[0].data.text;
  for (const label of ['طرح ۱', 'طرح ۲', 'طرح ۳']) assert.match(text, new RegExp(label));
  for (const amount of ['۶۴۰', '۶۱۸', '۶۰۵']) assert.match(text, new RegExp(amount));
  assert.match(text, /۴ بسته نوشابه جور/);
  assert.match(text, /۱۰ بسته نوشابه جور/);
  assert.match(text, /پیش از سفارش استعلام کنید/);
});
