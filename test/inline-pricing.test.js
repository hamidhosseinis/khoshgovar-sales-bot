import test from 'node:test';
import assert from 'node:assert/strict';
import { approvedSinglePackOffer, productDetail } from '../src/bot-ui.js';

const env = { PRICE_POLICY_APPROVED: 'true', ROUNDING_RULE: 'HALF_UP_IRR' };
const product = {
  product_id: 'P003', product_name: 'نوشابه اورجینال ۲٫۵ لیتری',
  units_per_pack: '6', variants: [], group_id: 'ORIGINAL_SODA', group_verified: 'TRUE',
  category_name: 'نوشابه اورجینال',
  box_base_price: { amountToman: '654107', unitRawToman: '109017.83333333333', basis: 'PACK' },
  base_price_irr: '6541070', base_price_basis: 'PACK_WITH_TAX',
  final_price_approved_for_public: true,
  consumer_price: { amountIRR: '1220000', basis: 'UNIT' },
};
const plan = { plan_id: 'D001', plan_name: 'طرح یک', discount_percent: '10' };
const data = {
  products: [product], plans: [plan],
  links: [{ product_id: 'P003', plan_id: 'D001' }],
  targets: [{ plan_id: 'D001', group_id: 'ORIGINAL_SODA' }],
  requirements: [{plan_id: 'D001', group_id: 'ORIGINAL_SODA',
    quantity_rule: 'RANGE', min_packs: '1', max_packs: '10'}],
};
const actions = view => view.reply_markup.inline_keyboard.flat()
  .map(button => button.callback_data).filter(Boolean);

test('six product sections stay in order; single-pack quote includes per-unit average', () => {
  const chosen = approvedSinglePackOffer(product, data, env);
  assert.equal(chosen.plan.plan_id, 'D001');
  assert.equal(chosen.priceIRR, '5886963'); // approved HALF_UP_IRR per pack
  const flavored = {...product, variants:['کوکاکولا','فانتا پرتقالی']};
  const view = productDetail(flavored, {...data,products:[flavored]}, env);
  const ordered = [
    '🥤 نوشابه اورجینال ۲٫۵ لیتری',
    '📦 تعداد در بسته: ۶ عدد',
    '💳 قیمت مصرف‌کننده هر بطری: ۱۲۲٬۰۰۰ تومان',
    '🏷 قیمت پایه هر بطری: ۱۰۹٬۰۱۷٫۸۳۳۳۳۳۳۳۳۳۳ تومان',
    '💰 قیمت تمام‌شده هر بطری با تخفیف («طرح یک»): ۹۸٬۱۱۶٫۰۵ تومان',
    '🎨 طعم‌ها: کوکاکولا، فانتا پرتقالی',
  ];
  const offsets = ordered.map(part => view.text.indexOf(part));
  assert.ok(offsets.every(x => x >= 0), view.text);
  assert.deepEqual([...offsets].sort((a,b) => a-b), offsets);
  assert.doesNotMatch(view.text, /پایه هر بسته|قیمت هر بسته|حاشیه سود|ریال|⚠️/);
  assert.ok(actions(view).includes('product-plans:P003:1'));
  assert.ok(!actions(view).includes('variants:P003:1'));
  assert.ok(!actions(view).some(x => /^(final|price|prices|add):/.test(x)));
});

test('no single-pack quote appears when quantity, approval, or policy is missing', () => {
  const minTwo = {...data, requirements: [{
    ...data.requirements[0], quantity_rule: 'MINIMUM', min_packs: '2',
  }]};
  assert.equal(approvedSinglePackOffer(product, minTwo, env), null);
  const view = productDetail(product, minTwo, env);
  assert.doesNotMatch(view.text, /۹۸٬۱۱۶٫۰۵|قیمت تمام‌شده هر بطری|حاشیه سود/);
  assert.match(view.text, /طرح تخفیفی دارد؛ قیمت هر بطری قابل اعلام نیست/);
  assert.ok(actions(view).includes('product-plans:P003:1'));
  assert.equal(approvedSinglePackOffer(product, data, {}), null);
  assert.equal(approvedSinglePackOffer(product, data, {
    PRICE_POLICY_APPROVED:'true', ROUNDING_RULE:'UNAPPROVED',
  }), null);
  const notVerified = {...product, final_price_approved_for_public:false};
  assert.equal(approvedSinglePackOffer(notVerified, {...data,products:[notVerified]}, env), null);
  assert.equal(approvedSinglePackOffer(product, {...data,plans:[]}, env), null);
});

test('missing retail price and invalid pack quantity never fabricate monetary details', () => {
  const hiddenRetail = {...product, consumer_price:null};
  const noRetail = productDetail(hiddenRetail, {...data,products:[hiddenRetail]}, env);
  assert.match(noRetail.text, /قیمت مصرف‌کننده هر بطری: منتشر نشده/);
  assert.match(noRetail.text, /قیمت تمام‌شده هر بطری با تخفیف \(«طرح یک»\): ۹۸٬۱۱۶٫۰۵ تومان/);
  const packRetail = {...product, consumer_price:{amountIRR:'5500000',basis:'PACK'}};
  assert.match(productDetail(packRetail, {...data,products:[packRetail]}, env).text,
    /قیمت مصرف‌کننده هر بطری: حدود ۹۱٬۶۶۶٫۶۶۶۷ تومان/);
  const invalid = {...product, units_per_pack:'0'};
  const invalidView = productDetail(invalid, {...data,products:[invalid]}, env);
  assert.match(invalidView.text, /تعداد در بسته: نامشخص/);
  assert.doesNotMatch(invalidView.text, /قیمت تمام‌شده هر بطری با تخفیف/);
});

test('repeating average is marked approximate; no rounding claim is invented', () => {
  const unusual = {...product, units_per_pack:'7'};
  const view = productDetail(unusual, {...data, products:[unusual]}, env);
  assert.match(view.text, /قیمت تمام‌شده هر بطری با تخفیف \(«طرح یک»\): حدود ۸۴٬۰۹۹٫۴۷۱۴ تومان/);
});

test('without a standalone tier, only approved plan hints are visible', () => {
  const d002={plan_id:'D002',plan_name:'طرح ترکیبی',discount_percent:'13'};
  const combined={...data, plans:[plan,d002],
    links:[...data.links,{product_id:product.product_id,plan_id:'D002'}],
    targets:[...data.targets,{plan_id:'D002',group_id:'ORIGINAL_SODA'}],
    requirements: [{...data.requirements[0], min_packs:'2'}],
  };
  const view=productDetail(product,combined,env);
  assert.match(view.text,/طرح‌های تخفیفی متنوع و ترکیبی دارد/);
  assert.doesNotMatch(view.text,/۹۸٬۱۱۶٫۰۵|قیمت تمام‌شده هر بطری/);
  const none={...data,plans:[]};
  const noPlan=productDetail(product,none,env);
  assert.match(noPlan.text,/قیمت تخفیفی یک‌بسته‌ای برای این محصول منتشر نشده است/);
  assert.ok(!actions(noPlan).some(x => x.startsWith('product-plans:')));
});

test('manipulated multi-pack plan cannot invent a single-pack tier', () => {
  const alternative={plan_id:'D011',plan_name:'طرح دوازده درصد',discount_percent:'12'};
  const richer={...data,plans:[plan,alternative],
    links:[...data.links,{product_id:'P003',plan_id:'D011'}],
    targets:[...data.targets,{plan_id:'D011',group_id:'ORIGINAL_CANADA_COMBINED'}],
    requirements:[...data.requirements,{plan_id:'D011',
      group_id:'ORIGINAL_CANADA_COMBINED',quantity_rule:'MINIMUM',min_packs:'1'}],
  };
  assert.equal(approvedSinglePackOffer(product,richer,env).plan.plan_id,'D001');
  assert.doesNotMatch(productDetail(product,richer,env).text,/قیمت تمام‌شده هر بطری با تخفیف \(«طرح دوازده درصد»/);
});
