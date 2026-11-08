import test from 'node:test';
import assert from 'node:assert/strict';
import {syncTelegramWebhook, PUBLIC_WEBHOOK_URL} from '../src/telegram-webhook-sync.js';

function fakeDb() {
  const rows = new Map();
  return {
    rows,
    prepare(sql) {
      return {
        bind(...args) {
          return {
            async first() {
              assert.match(sql, /^SELECT /);
              return rows.has(args[0]) ? {value:rows.get(args[0])} : null;
            },
            async run() {
              assert.match(sql, /^INSERT /);
              rows.set(args[0],args[1]);
              return {success:true};
            }
          };
        }
      };
    }
  };
}
const env = () => ({
  CART_DB: fakeDb(),
  TELEGRAM_BOT_TOKEN: 'TEST_ONLY_DUMMY_TOKEN',
  TELEGRAM_WEBHOOK_SECRET: 'TEST_ONLY_WEBHOOK_SECRET'
});

test('does not call Telegram when either required Secret is missing', async () => {
  let called=false;
  const e=env();
  delete e.TELEGRAM_BOT_TOKEN;
  assert.equal(await syncTelegramWebhook(e,async()=>{called=true;}),'not_configured');
  assert.equal(called,false);
});
test('registers webhook from env once and keeps only fingerprint in D1', async () => {
  const e=env();
  const calls=[];
  const send=async (url,init)=>{
    calls.push({url,request:JSON.parse(init.body)});
    return new Response(JSON.stringify({ok:true,result:true}),{
      status:200,headers:{'content-type':'application/json'}
    });
  };
  assert.equal(await syncTelegramWebhook(e,send),'registered');
  assert.equal(calls.length,1);
  assert.equal(calls[0].request.url,PUBLIC_WEBHOOK_URL);
  assert.equal(calls[0].request.secret_token,e.TELEGRAM_WEBHOOK_SECRET);
  assert.deepEqual(calls[0].request.allowed_updates,['message', 'callback_query']);
  assert.equal(calls[0].request.drop_pending_updates,false);
  assert.equal(await syncTelegramWebhook(e,send),'already_registered');
  assert.equal(calls.length,1);
  const stored=JSON.stringify([...e.CART_DB.rows.entries()]);
  assert.doesNotMatch(stored,/TEST_ONLY_WEBHOOK_SECRET|TEST_ONLY_DUMMY_TOKEN/);
  e.TELEGRAM_BOT_TOKEN='DIFFERENT_TEST_TOKEN';
  assert.equal(await syncTelegramWebhook(e,send),'registered');
  assert.equal(calls.length,2);
});
test('invalid secret and Telegram errors never mark webhook as registered', async () => {
  const e=env();
  e.TELEGRAM_WEBHOOK_SECRET='invalid with spaces';
  assert.equal(await syncTelegramWebhook(e,async()=>{throw Error('called');}),'invalid_secret');
  e.TELEGRAM_WEBHOOK_SECRET='TEST_ONLY_WEBHOOK_SECRET';
  const failed=async()=>new Response(JSON.stringify({ok:false,description:'bad token'}),{
    status:401,headers:{'content-type':'application/json'}
  });
  assert.equal(await syncTelegramWebhook(e,failed),'telegram_request_failed');
  assert.equal(e.CART_DB.rows.size,0);
  assert.equal(await syncTelegramWebhook(e,async()=>{throw Error('failed');}),'temporary_failure');
  assert.equal(e.CART_DB.rows.size,0);
});
