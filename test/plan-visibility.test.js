import test from 'node:test';
import assert from 'node:assert/strict';
import { inGroup } from '../src/engine.js';
import { planAppliesToProduct } from '../src/plan-visibility.js';
import { productPlanList, finalPriceList, planQuote, planProducts } from '../src/bot-ui.js';

// Deliberately link every product to every plan. Even if the spreadsheet has
// overbroad links, the server must only show discounts for eligible groups.
const groups = {
  D001: ['ORIGINAL_SODA'],
  D002: ['ORIGINAL_SODA', 'NON_SODA'],
  D003: ['ORIGINAL_SODA', 'NON_SODA_NON_DASANI'],
  D004: ['CANADA_SODA'],
  D006: ['DASANI_WATER'],
  D007: ['ENERGY_DRINK'],
  D008: ['DOOGH_MILK'],
  D009: ['DIVERSITY_EXCL_CORE'],
  D010: ['DIVERSITY_EXCL_CORE'],
  D011: ['ORIGINAL_CANADA_COMBINED'],
  D012: ['ORIGINAL_SODA', 'VARIETY_NON_WATER_NON_MILK'],
};
const ids = Object.keys(groups);
const product = (product_id, product_name, group_id, category_name = '') => ({
  product_id, product_name, group_id, category_name, group_verified: 'TRUE',
  box_base_price: { amountIRR: '1000000', unitRawIRR: '166666.6667' },
});
const products = [
  product('P003', 'نوشابه اورجینال ۱.۵ لیتری', 'ORIGINAL_SODA', 'نوشابه اورجینال'),
  product('P046', 'نوشابه کانادا ۱.۵ لیتری', 'CANADA_SODA', 'نوشابه کانادا'),
  product('P011', 'آب دسانی ۱.۵ لیتری', 'DASANI_WATER', 'آب'),
  product('P020', 'شیر طعم دار', 'MILK'),
  product('P014', 'دوغ خوشگوار', 'DOOGH'),
  product('P034', 'انرژی زا', 'ENERGY_DRINK'),
  product('P023', 'آبمیوه گازدار فرشی دی', 'DIVERSITY_EXCL_CORE'),
  product('P024', 'لیموناد خوشگوار', 'KHOSH_LEMONADE'),
];
const plans = ids.map(plan_id => ({
  plan_id, plan_name: 'طرح ' + plan_id, discount_percent: '15', conditions: 'شرایط تأییدشده',
}));
const data = { products, plans,
  links: products.flatMap(p => ids.map(plan_id => ({ product_id: p.product_id, plan_id }))),
  targets: ids.flatMap(plan_id => groups[plan_id].map(group_id => ({ plan_id, group_id }))),
  requirements: [] };
const find = id => products.find(p => p.product_id === id);
const visible = p => plans.filter(plan => planAppliesToProduct(p, plan, data))
  .map(p => p.plan_id);
const buttons = view => view.reply_markup.inline_keyboard.flat()
  .map(x => x.callback_data).filter(Boolean);

test('reviewed scopes hold for original, Canada, variety, energy, water and milk', () => {
  assert.deepEqual(visible(find('P003')), ['D001','D002','D003','D011','D012']);
  assert.deepEqual(visible(find('P046')), ['D004','D011','D012']);
  assert.deepEqual(visible(find('P034')), ['D002','D003','D007','D009','D010','D012']);
  assert.deepEqual(visible(find('P023')), ['D002','D003','D009','D010','D012']);
  assert.deepEqual(visible(find('P024')), ['D002','D003','D009','D010','D012']);
  assert.deepEqual(visible(find('P011')), ['D002','D006']);
  assert.deepEqual(visible(find('P020')), ['D002','D003','D008']);
  assert.deepEqual(visible(find('P014')), ['D002','D003','D008','D009','D010','D012']);
});

test('not all 20% or 33% plans are interchangeable; each requires its own group', () => {
  for (const p of products) {
    assert.equal(visible(p).includes('D007'), p.product_id === 'P034');
    assert.equal(visible(p).includes('D006'), p.product_id === 'P011');
    assert.equal(visible(p).includes('D008'), ['P014','P020'].includes(p.product_id));
    assert.equal(visible(p).includes('D009'), !['P003','P046','P011','P020'].includes(p.product_id));
    assert.equal(visible(p).includes('D010'), !['P003','P046','P011','P020'].includes(p.product_id));
  }
});

test('bad target additions or new unreviewed plan IDs cannot widen a promotion', () => {
  const enlarged = { ...data, targets: [...data.targets,
    { plan_id: 'D009', group_id: 'ORIGINAL_SODA' },
    { plan_id: 'D007', group_id: 'CANADA_SODA' },
    { plan_id: 'D013', group_id: 'ORIGINAL_SODA' }],
    links: [...data.links, { product_id: 'P003', plan_id: 'D013' }] };
  assert.ok(!planAppliesToProduct(find('P003'), plans.find(p => p.plan_id === 'D009'), enlarged));
  assert.ok(!planAppliesToProduct(find('P046'), plans.find(p => p.plan_id === 'D007'), enlarged));
  assert.ok(!planAppliesToProduct(find('P003'), { plan_id: 'D013' }, enlarged));
  const unverified = { ...find('P034'), group_verified: 'FALSE' };
  assert.deepEqual(visible(unverified), []);
});

test('retired D005 stays hidden from product quote even with forged links and targets', () => {
  const retired = { plan_id: 'D005', plan_name: 'withdrawn', discount_percent: '23' };
  const polluted = { ...data,
    links: [...data.links, { product_id: 'P046', plan_id: 'D005' }],
    targets: [...data.targets, { plan_id: 'D005', group_id: 'CANADA_SODA' }] };
  assert.equal(planAppliesToProduct(find('P046'), retired, polluted), false);
});

test('explicit names guard against misclassified soda, water and milk in variety', () => {
  for (const name of ['نوشابه اورجینال ۱.۵ لیتری', 'نوشابه کانادا قوطی',
    'آب دسانی ۰.۵ لیتری', 'شیر طعم دار']) {
    const incorrect = product('WRONG', name, 'DIVERSITY_EXCL_CORE');
    assert.equal(inGroup(incorrect, 'DIVERSITY_EXCL_CORE'), false, name);
  }
  assert.equal(inGroup(product('JUICE','آبمیوه گازدار فرشی دی','DIVERSITY_EXCL_CORE'),
    'DIVERSITY_EXCL_CORE'), true);
  assert.equal(inGroup(product('WRONG','نوشابه کانادا قوطی','ORIGINAL_SODA','نوشابه کانادا'),
    'ORIGINAL_SODA'), false);
});

test('quote and plan routes share the same filter, including second page of energy offers', () => {
  const original = find('P003'), energy = find('P034');
  const d009 = plans.find(p => p.plan_id === 'D009');
  assert.doesNotMatch(finalPriceList(original, data).text, /D009|D010/);
  assert.doesNotMatch(productPlanList(original, data).text, /D009|D010/);
  assert.match(planQuote(original, d009, data).text, /منتشر نشده است/);
  assert.ok(!buttons(planProducts(d009, data)).includes('product:P003'));
  assert.ok(!buttons(planProducts(d009, data)).includes('product:P046'));
  assert.ok(!buttons(planProducts(d009, data)).includes('product:P011'));
  assert.ok(!buttons(planProducts(d009, data)).includes('product:P020'));
  assert.ok(buttons(planProducts(d009, data)).includes('product:P034'));
  assert.ok(buttons(planProducts(d009, data)).includes('product:P023'));
  assert.ok(buttons(productPlanList(energy, data)).includes('quote:P034:D007'));
  assert.ok(buttons(productPlanList(energy, data)).includes('product:P034'));
  assert.ok(buttons(productPlanList(energy, data, 2)).includes('quote:P034:D012'));
});
