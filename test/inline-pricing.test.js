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

test('approved one-pack offer, visible retail/base prices and potential margin', () => {
  const chosen = approvedSinglePackOffer(product, data, env);
  assert.equal(chosen.plan.plan_id, 'D001');
  assert.equal(chosen.priceIRR, '5886963'); // approved HALF_UP_IRR per pack
  const view = productDetail(product, data, env);
  assert.match(view.text, /مصرف‌کننده هر عدد: ۱۲۲٬۰۰۰ تومان/);
  assert.match(view.text, /پایه هر بسته: ۶۵۴٬۱۰۷ تومان/);
  assert.match(view.text, /پایه هر عدد: ۱۰۹٬۰۱۷٫۸۳۳۳۳۳۳۳۳۳۳ تومان/);
  assert.match(view.text, /قیمت خرید یک بسته با «طرح یک»: ۵۸۸٬۶۹۶٫۳ تومان/);
  assert.match(view.text, /تخفیف این طرح با خرید یک بسته هم اعمال می‌شود/);
  assert.match(view.text, /حاشیه سود ناخالص احتمالی: ۱۴۳٬۳۰۳٫۷ تومان \(۱۹٫۵۸٪\)/);
  assert.match(view.text, /پیش از سایر هزینه‌هاست/);
  assert.ok(actions(view).includes('product-plans:P003:1'));
  assert.ok(!actions(view).some(x => /^(final|price|prices):/.test(x)));
});

test('do not invent one-pack discount or margin for multi-pack or unapproved rules', () => {
  const minTwo = {...data, requirements: [{
    ...data.requirements[0], quantity_rule: 'MINIMUM', min_packs: '2',
  }]};
  assert.equal(approvedSinglePackOffer(product, minTwo, env), null);
  assert.doesNotMatch(productDetail(product, minTwo, env).text, /۵۸۸٬۶۹۶٫۳|حاشیه سود ناخالص/);
  assert.equal(approvedSinglePackOffer(product, data, {}), null);
  assert.equal(approvedSinglePackOffer(product, data, {
    PRICE_POLICY_APPROVED:'true', ROUNDING_RULE:'UNAPPROVED',
  }), null);
  const notVerified = {...product, final_price_approved_for_public:false};
  assert.equal(approvedSinglePackOffer(notVerified, {...data,products:[notVerified]}, env), null);
  assert.equal(approvedSinglePackOffer(product, {...data,plans:[]}, env), null);
});

test('retail approval and quantity basis constrain the displayed potential margin', () => {
  const hiddenRetail = {...product,consumer_price:null};
  const noRetailView = productDetail(hiddenRetail, {...data,products:[hiddenRetail]}, env);
  assert.match(noRetailView.text, /قیمت مصرف‌کننده معتبر برای محاسبه موجود نیست/);
  assert.doesNotMatch(noRetailView.text, /۱۴۳٬۳۰۳٫۷|۱۹٫۵۸٪/);
  const packRetail = {...product, consumer_price:{amountIRR:'5500000',basis:'PACK'}};
  const packView = productDetail(packRetail, {...data,products:[packRetail]}, env);
  assert.match(packView.text, /مصرف‌کننده هر بسته: ۵۵۰٬۰۰۰ تومان/);
  assert.match(packView.text, /حاشیه سود ناخالص احتمالی: −۳۸٬۶۹۶٫۳ تومان \(−۷٫۰۴٪\)/);
  const invalidQty = {...product, units_per_pack:'0'};
  const invalidView = productDetail(invalidQty, {...data,products:[invalidQty]}, env);
  assert.doesNotMatch(invalidView.text, /حاشیه سود ناخالص احتمالی/);
});

test('a manipulated multi-pack plan cannot invent a single-pack tier', () => {
  const alternative={plan_id:'D011',plan_name:'طرح دوازده درصد',discount_percent:'12'};
  const richer={...data,plans:[plan,alternative],
    links:[...data.links,{product_id:'P003',plan_id:'D011'}],
    targets:[...data.targets,{plan_id:'D011',group_id:'ORIGINAL_CANADA_COMBINED'}],
    requirements:[...data.requirements,{plan_id:'D011',
      group_id:'ORIGINAL_CANADA_COMBINED',quantity_rule:'MINIMUM',min_packs:'1'}],
  };
  assert.equal(approvedSinglePackOffer(product,richer,env).plan.plan_id,'D001');
  assert.doesNotMatch(productDetail(product,richer,env).text,/قیمت خرید یک بسته با «طرح دوازده درصد»/);
});
