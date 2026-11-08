import test from 'node:test';
import assert from 'node:assert/strict';
import { generateKeyPairSync } from 'node:crypto';
import { sheetCatalog } from '../src/sheets.js';

test('canonical updated Sheets schema loads products without removed Product_Variants tab', async () => {
  const { privateKey } = generateKeyPairSync('rsa', { modulusLength: 2048 });
  const id = '1yETt1zcPAIXTQ_KJcEi1IrSCtIDBTpPa8l8JwhdBSfk';
  const env = {
    SALES_SPREADSHEET_ID: id,
    GOOGLE_SERVICE_ACCOUNT_JSON: JSON.stringify({
      client_email: 'test-only@example.invalid',
      private_key: privateKey.export({ type: 'pkcs8', format: 'pem' }),
      token_uri: 'https://oauth2.googleapis.com/token',
    }),
  };
  const rangesSeen = [];
  const json = body => new Response(JSON.stringify(body), {
    status: 200, headers: { 'content-type': 'application/json' },
  });
  const fakeFetch = async (endpoint) => {
    if (endpoint === 'https://oauth2.googleapis.com/token') {
      return json({access_token:'MOCK_TOKEN_DO_NOT_USE',expires_in:3600});
    }
    const url = new URL(endpoint);
    assert.equal(url.pathname, '/v4/spreadsheets/' + id + '/values:batchGet');
    rangesSeen.push(...url.searchParams.getAll('ranges'));
    return json({valueRanges:[
      {values:[[
        'product_id','product_name','units_per_pack','publish_status',
        'approved_for_public','category_name','flavor','variants_json',
      ],[
        'P003','نوشابه اورجینال 2.5 لیتری',6,'PUBLISHED',true,
        'نوشابه اورجینال','کوکاکولا، فانتا',
        JSON.stringify([{product_id:'P003',variant_name:'کوکاکولا',approved_for_public:false}]),
      ],[
        'P001','',6,'PUBLISHED',true,'نوشابه اورجینال','','',
      ]]},
      {values:[['plan_id','plan_name']]},
      {values:[['product_id','plan_id']]},
      {values:[['plan_id','requirement_id']]},
      {values:[['plan_id','target_order']]},
    ]});
  };
  const catalog = await sheetCatalog(env, fakeFetch, Date.parse('2026-11-08T12:00:00Z'));
  assert.deepEqual(catalog.products.map(p=>p.product_id),['P003']);
  assert.deepEqual(catalog.products[0].variants,[]);
  assert.equal(catalog.products[0].consumer_price,null);
  assert.equal(catalog.products[0].box_base_price,null);
  assert.deepEqual(catalog.plans,[]);
  assert.equal(rangesSeen.length,5);
  assert.ok(rangesSeen.includes('Products!A1:U1000'));
  assert.ok(!rangesSeen.some(range=>range.includes('Product_Variants')));
});
