import test from 'node:test';
import assert from 'node:assert/strict';
import { publicData } from '../src/engine.js';
import { productDetail, planQuote, sheetToman, unitDetail } from '../src/bot-ui.js';

const row = {
  product_id: 'P003', product_name: 'نوشابه اورجینال 2.5 لیتری',
  publish_status: 'PUBLISHED', approved_for_public: 'TRUE',
  units_per_pack: '6', category_name: 'نوشابه اورجینال',
  base_price_per_box: '883929', box_unit_base_price: '147321.5',
  base_box_price_approved_for_public: 'TRUE',
};
const catalog = product => publicData({ Products: [product] }, '2026-11-09');

test('canonical box and unit prices display unchanged in toman, with no divide-by-ten', () => {
  const data = catalog(row);
  const p = data.products[0];
  assert.deepEqual(p.box_base_price, {
    amountToman: '883929', unitRawToman: '147321.5',
    basis: 'PACK', taxVerified: false,
  });
  const detail = productDetail(p, data);
  assert.doesNotMatch(detail.text, /پایه هر بسته/);
  assert.match(unitDetail(p).text, /پایه هر بطری: ۱۴۷٬۳۲۱٫۵ تومان/);
  assert.match(detail.text, /قیمت پایه هر بطری: ۱۴۷٬۳۲۱٫۵ تومان/);
  assert.doesNotMatch(detail.text, /۸۸٬۳۹۲٫۹ تومان/);
  assert.equal(sheetToman('0.25'), '۰٫۲۵ تومان');
  assert.equal(sheetToman('0.1.2'), null);
});

test('public publication approval still gates the two source prices independently', () => {
  const p = catalog({...row, base_box_price_approved_for_public: 'FALSE'}).products[0];
  assert.equal(p.box_base_price, null);
  assert.doesNotMatch(productDetail(p, {products:[p],plans:[]}).text, /۸۸۳٬۹۲۹|۱۴۷٬۳۲۱/);
  const mismatch = catalog({...row,box_unit_base_price:'120000'}).products[0];
  assert.equal(mismatch.box_base_price, null);
});

test('verified source toman is converted to rial only for approved internal rounding', () => {
  const p = catalog({...row,final_price_approved_for_public:'TRUE',
    base_price_basis:'PACK_WITH_TAX'}).products[0];
  assert.equal(p.base_price_irr, '8839290');
  assert.equal(p.box_base_price.amountToman, '883929');
});
