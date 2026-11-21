import test from 'node:test';
import assert from 'node:assert/strict';
import { approvedOwnerRates, publicData } from '../src/engine.js';
import { productDetail, discountedBottleToman } from '../src/bot-ui.js';

const rates = [10,12,13,15,16,20,25,30,33];
const rateRows = rates.map(discount_percent => ({
  discount_percent: String(discount_percent),
  is_active: 'TRUE', approved_for_owner: 'TRUE',
  approved_for_public: 'FALSE', review_status: 'OWNER_APPROVED',
}));
const product = {
  product_id: 'P003', product_name: 'نوشابه اورجینال ۲/۵ لیتری',
  publish_status: 'PUBLISHED', approved_for_public: 'TRUE',
  units_per_pack: '6', base_price_per_box: '883929',
  box_unit_base_price: '147321.5', base_box_price_approved_for_public: 'TRUE',
  consumer_price_per_bottle: '150000',
};
const source = extra => ({
  Products: [{ ...product, ...extra }],
  Price_Rates: rateRows,
});
const today = '2026-11-21';
const ownerData = extra => publicData(source(extra), today, { ownerOnly: true });

test('only owner-approved active price rates from canonical tab are displayed', () => {
  const rowSet = [...rateRows,
    { discount_percent:'50', is_active:'TRUE', approved_for_owner:'FALSE', review_status:'OWNER_APPROVED' },
    { discount_percent:'40', is_active:'FALSE', approved_for_owner:'TRUE', review_status:'OWNER_APPROVED' },
    { discount_percent:'66', is_active:'TRUE', approved_for_owner:'TRUE', review_status:'DRAFT' },
    { discount_percent:'10', is_active:'TRUE', approved_for_owner:'TRUE', review_status:'OWNER_APPROVED' },
    { discount_percent:'11.5', is_active:'TRUE', approved_for_owner:'TRUE', review_status:'OWNER_APPROVED' },
  ];
  assert.deepEqual(approvedOwnerRates(rowSet),rates);
  const d = ownerData();
  assert.deepEqual(d.priceRates, rates);
  assert.equal(d.plans.length, 0);
  assert.equal(d.products[0].owner_consumer_price_raw, '150000');
  const view = productDetail(d.products[0], d);
  assert.match(view.text, /قیمت پایه هر بطری: ۱۴۷٬۳۲۲ تومان/);
  assert.match(view.text, /قیمت مصرف‌کننده هر بطری: ۱۵۰٬۰۰۰ تومان/);
  assert.doesNotMatch(view.text, /واحد پول تأیید نشده|ریال/);
  assert.match(view.text, /قیمت تمام‌شده محاسباتی هر بطری/);
  for(const r of rates) {
    const label = String(r).replace(/\d/g, x=>'۰۱۲۳۴۵۶۷۸۹'[Number(x)]);
    assert.ok(view.text.includes(label+'٪:'));
  }
  assert.match(view.text, /• ۱۰٪: ۱۳۲٬۵۹۰ تومان/);
  assert.doesNotMatch(view.text, /طرح‌های فروش|ریال|\/نهایی قطعی/);
  assert.ok(!view.reply_markup.inline_keyboard.flat().some(
    b => /^(?:plan|final|cart)/.test(b.callback_data || '')));
});

test('default public catalog does not contain owner-only rates or private consumer amounts', () => {
  const data = publicData(source(), today);
  assert.deepEqual(data.priceRates, []);
  assert.equal(data.products[0].owner_consumer_price_raw, null);
  assert.match(productDetail(data.products[0], data).text, /نرخ تأییدشده برای محاسبه موجود نیست/);
});

test('invalid or unapproved base never produces a discounted price', () => {
  for(const extra of [
    { base_box_price_approved_for_public:'FALSE' },
    { box_unit_base_price:'100000' },
    { base_price_per_box:'' },
    { units_per_pack:'0' },
  ]) {
    const d = ownerData(extra);
    const view = productDetail(d.products[0], d);
    assert.doesNotMatch(view.text, /• ۱۰٪:/);
    assert.match(view.text, /پایه و نرخ تأییدشده برای محاسبه موجود نیست/);
  }
});

test('ceil each displayed per-bottle price once after applying the rate to full pack base', () => {
  assert.equal(discountedBottleToman('883929', 10, 6), '۱۳۲٬۵۹۰ تومان');
  assert.equal(discountedBottleToman('883929', 33, 6), '۹۸٬۷۰۶ تومان');
  assert.equal(discountedBottleToman('883929', 0, 6), '۱۴۷٬۳۲۲ تومان');
});
