import test from 'node:test';
import assert from 'node:assert/strict';
import { handleRequest } from '../src/index.js';

const env = {
  TELEGRAM_BOT_TOKEN: 'TEST_ONLY_NOT_REAL',
  TELEGRAM_WEBHOOK_SECRET: 'TEST_ONLY_WEBHOOK_SECRET',
  ADMIN_TELEGRAM_USER_ID: '123',
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
    const result = endpoint.endsWith('/sendMessage') ? { message_id: 12345 } : {};
    return new Response(JSON.stringify({ ok: true, result }), {
      headers: { 'content-type': 'application/json' },
    });
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
test('start removes the old reply keyboard and shows only inline buttons', async () => {
  const { calls, fetchMock } = fakeSender();
  const res = await handleRequest(makeRequest(), env, fetchMock);
  assert.equal(res.status, 200);
  // The old keyboard is removed first; its message is then edited in place.
  assert.equal(calls.length, 2);
  assert.equal(calls[0].data.reply_markup.remove_keyboard, true);
  assert.equal(calls[1].data.reply_markup.keyboard, undefined);
  assert.ok(calls[1].data.reply_markup.inline_keyboard.flat()
    .some(b => b.text === '💬 مشاوره' && b.url === 'https://t.me/Hamidhosseinis'));
  assert.ok(calls[1].data.reply_markup.inline_keyboard.flat()
    .every(b => b.callback_data !== 'cart'));
});
test('start edits the same message to inline when Telegram supplies message ID',async()=>{
  const calls=[];
  const sender=async(endpoint,init)=>{
    calls.push({endpoint,data:JSON.parse(init.body)});
    const result=endpoint.endsWith('sendMessage') ? {message_id:444} : {};
    return new Response(JSON.stringify({ok:true,result}),{
      headers:{'content-type':'application/json'},
    });
  };
  const res=await handleRequest(makeRequest(),env,sender);
  assert.equal(res.status,200);
  assert.equal(calls.length,2);
  assert.match(calls[0].endpoint,/sendMessage$/);
  assert.equal(calls[0].data.reply_markup.remove_keyboard,true);
  assert.match(calls[1].endpoint,/editMessageText$/);
  assert.equal(calls[1].data.message_id,444);
  assert.ok(calls[1].data.reply_markup.inline_keyboard.length);
});
test('consultation shortcut opens the public Telegram chat URL without Sheets or D1', async () => {
  const { calls, fetchMock } = fakeSender();
  const brokenSheetsEnv = {
    ...env, GOOGLE_SERVICE_ACCOUNT_JSON: 'invalid', SALES_SPREADSHEET_ID: 'not-connected',
  };
  const res = await handleRequest(makeRequest(update('💬 مشاوره')), brokenSheetsEnv, fetchMock);
  assert.equal(res.status, 200);
  assert.equal(calls.length, 2);
  assert.equal(calls[0].data.reply_markup.remove_keyboard, true);
  assert.match(calls[1].data.text, /مشاوره/);
  assert.deepEqual(calls[1].data.reply_markup.inline_keyboard, [[{
    text: '💬 گفت‌وگوی مستقیم با مشاور', url: 'https://t.me/Hamidhosseinis',
  }]]);
});
test('consultation command remains accessible in public fallback mode', async () => {
  const { calls, fetchMock } = fakeSender();
  await handleRequest(makeRequest(update('/consult')), env, fetchMock);
  assert.equal(calls.length, 2);
  assert.equal(calls[0].data.reply_markup.remove_keyboard, true);
  assert.equal(calls[1].data.reply_markup.inline_keyboard[0][0].url, 'https://t.me/Hamidhosseinis');
});
test('pricing menu denies unapproved calculations', async () => {
  const { calls, fetchMock } = fakeSender();
  await handleRequest(makeRequest(update('🧮 محاسبه قیمت')), env, fetchMock);
  assert.match(calls[1].data.text, /فعلاً مبلغی نمایش داده نمی‌شود/);
});
test('missing owner ID silently denies even the administrator command', async () => {
  const { calls, fetchMock } = fakeSender();
  const { ADMIN_TELEGRAM_USER_ID: _unused, ...withoutOwner } = env;
  const res = await handleRequest(makeRequest(update('/admin')), withoutOwner, fetchMock);
  assert.equal(res.status, 200);
  assert.equal(calls.length, 0);
});
test('another user receives nothing even if an administrator exists', async () => {
  const { calls, fetchMock } = fakeSender();
  const res = await handleRequest(makeRequest(update('/admin', 123)), { ...env, ADMIN_TELEGRAM_USER_ID: '444' }, fetchMock);
  assert.equal(res.status, 200);
  assert.equal(calls.length, 0);
});
test('admin command only acknowledges admin for verified private ID; no admin operations', async () => {
  const { calls, fetchMock } = fakeSender();
  await handleRequest(makeRequest(update('/admin', 123)), { ...env, ADMIN_TELEGRAM_USER_ID: '123' }, fetchMock);
  assert.match(calls[1].data.text, /امکانات مدیریت هنوز فعال نشده‌اند/);
});
test('owner-only gate rejects non-owner commands, text, and callbacks without Telegram API calls', async () => {
  const { calls, fetchMock } = fakeSender();
  for (const text of ['/start', '/products', '/plans', '/consult', 'نوشابه', '/admin']) {
    const res = await handleRequest(makeRequest(update(text, 444)), env, fetchMock);
    assert.equal(res.status, 200);
  }
  const res = await handleRequest(makeRequest({
    callback_query: {
      id: 'UNAUTHORIZED_CB', from: { id: 444 }, data: 'menu',
      message: { message_id: 42, chat: { id: 444, type: 'private' } },
    },
  }), env, fetchMock);
  assert.equal(res.status, 200);
  assert.equal(calls.length, 0);
});
test('owner-only gate fails closed for absent or invalid IDs', async () => {
  for (const configured of [undefined, '', '0', '123abc', '9007199254740992', '@Hamidhosseinis']) {
    const { calls, fetchMock } = fakeSender();
    const ownerEnv = { ...env, ADMIN_TELEGRAM_USER_ID: configured };
    const res = await handleRequest(makeRequest(update('/start')), ownerEnv, fetchMock);
    assert.equal(res.status, 200);
    assert.equal(calls.length, 0);
  }
});
test('group messages and malformed callbacks are ignored', async () => {
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

function callback(data, fromId = 123) {
  return { update_id: 2, callback_query: {
    id: 'SAFE_TEST_CB', data, from: { id: fromId },
    message: { message_id: 42, chat: { id: 123, type: 'private' } },
  } };
}
test('consultation callback is acknowledged and edited, not sent as a second message', async () => {
  const { calls, fetchMock } = fakeSender();
  const res = await handleRequest(makeRequest(callback('💬 مشاوره')), env, fetchMock);
  assert.equal(res.status, 200);
  assert.equal(calls.length, 2);
  assert.match(calls[0].endpoint, /answerCallbackQuery$/);
  assert.equal(calls[0].data.callback_query_id, 'SAFE_TEST_CB');
  assert.match(calls[1].endpoint, /editMessageText$/);
  assert.equal(calls[1].data.message_id, 42);
  assert.equal(calls[1].data.reply_markup.inline_keyboard[0][0].url, 'https://t.me/Hamidhosseinis');
});
test('callback by another user is ignored, including cart button actions', async () => {
  const { calls, fetchMock } = fakeSender();
  const res = await handleRequest(makeRequest(callback('cart:clear', 444)), env, fetchMock);
  assert.equal(res.status, 200);
  assert.equal(calls.length, 0);
});
test('unchanged Telegram edit does not create a duplicate message', async () => {
  const calls = [];
  const sender = async (endpoint, init) => {
    calls.push({ endpoint, data: JSON.parse(init.body) });
    if (endpoint.endsWith('/editMessageText')) {
      return new Response(JSON.stringify({ ok: false, description: 'Bad Request: message is not modified' }), {
        status: 400, headers: { 'content-type': 'application/json' },
      });
    }
    return new Response(JSON.stringify({ ok: true }), {
      headers: { 'content-type': 'application/json' },
    });
  };
  const res = await handleRequest(makeRequest(callback('💬 مشاوره')), env, sender);
  assert.equal(res.status, 200);
  assert.equal(calls.length, 2);
});

test('old bottom keyboard text selection is cleared and replaced with inline buttons', async () => {
  const calls = [];
  const sender = async (endpoint, init) => {
    calls.push({ endpoint, data: JSON.parse(init.body) });
    const result = endpoint.endsWith('sendMessage') ? { message_id: 501 } : {};
    return new Response(JSON.stringify({ ok: true, result }), {
      headers: { 'content-type': 'application/json' },
    });
  };
  const res = await handleRequest(makeRequest(update('📦 محصولات')), env, sender);
  assert.equal(res.status, 200);
  assert.equal(calls.length, 2);
  assert.equal(calls[0].data.reply_markup.remove_keyboard, true);
  assert.match(calls[1].endpoint, /editMessageText$/);
  assert.equal(calls[1].data.message_id, 501);
  assert.ok(calls[1].data.reply_markup.inline_keyboard.flat()
    .some(button => button.callback_data === 'products:1'));
  assert.equal(calls[1].data.reply_markup.keyboard, undefined);
});
test('menu command clears a stale reply keyboard; normal typed text does not spam cleanup', async () => {
  const { calls, fetchMock } = fakeSender();
  await handleRequest(makeRequest(update('/menu')), env, fetchMock);
  assert.equal(calls[0].data.reply_markup.remove_keyboard, true);
  assert.ok(calls[1].data.reply_markup.inline_keyboard);
  calls.length = 0;
  await handleRequest(makeRequest(update('نوشابه')), env, fetchMock);
  assert.equal(calls.length, 1);
  assert.ok(calls[0].data.reply_markup.inline_keyboard);
  assert.equal(calls[0].data.reply_markup.remove_keyboard, undefined);
});
