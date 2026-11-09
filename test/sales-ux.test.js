import test from 'node:test';
import assert from 'node:assert/strict';
import {publicData,eligiblePlans,inGroup} from '../src/engine.js';
import {planCategories,planGroupList,planRateList,planList} from '../src/bot-ui.js';
import {cartSummary,chooseFlavor} from '../src/cart-ui.js';
import {changeQuantity} from '../src/cart-storage.js';

const date='2026-11-09';
const definitions=[
  ['O','نوشابه اورجینال ۱.۵ لیتری','ORIGINAL_SODA'],
  ['C','نوشابه کانادا ۱.۵ لیتری','CANADA_SODA'],
  ['V','دلستر هی دی','HEYDAY_MALT'],
  ['L','لیموناد خوشگوار','KHOSH_LEMONADE'],
  ['M','شیر طعم‌دار','MILK'],
  ['D','دوغ خوشگوار','DOOGH'],
  ['W','آب دسانی','DASANI_WATER'],
];
const rawProduct=([product_id,product_name,group_id])=>({
  product_id,product_name,group_id,group_verified:'TRUE',publish_status:'PUBLISHED',
  approved_for_public:'TRUE',units_per_pack:'6',
  base_price_per_box:'654107',box_unit_base_price:'109017.83333333',
  base_box_price_approved_for_public:'TRUE',
});
const p=(plan_id,percent,conditions,category='نوشابه اورجینال و کانادا',rule='EXACT_MULTIPLE',max_multiplier='')=>({
  plan_id,plan_name:plan_id+' '+conditions,discount_percent:String(percent),conditions,
  plan_category_fa:category,quantity_rule:rule,max_multiplier,
  is_active:'TRUE',approved_for_public:'TRUE',review_status:'APPROVED',
  valid_from:date,
});
const plans=[
  p('D001',10,'۱ تا ۱۰','نوشابه اورجینال و کانادا','RANGE'),
  p('D002',13,'۴+۱ یا ۸+۲','نوشابه اورجینال و کانادا','EXACT_MULTIPLE','2'),
  p('D003',15,'۱۰+۳'),
  p('D004',16,'حداقل ۱۱ کانادا','طرح ویژه کانادا','MINIMUM'),
  p('D008',20,'حداقل ۳ شیر و دوغ','شیر و دوغ','MINIMUM'),
  p('D012',15,'۳+۱','نوشابه اورجینال و کانادا','EXACT_MULTIPLE','1'),
  p('D013',15,'۲۵+۵','نوشابه اورجینال و کانادا','EXACT_MULTIPLE','1'),
  {...p('D011',12,'بازنشسته','ترکیب اورجینال و کانادا','MINIMUM'),is_active:'FALSE'}
];
const specs={
 D001:[['ORIGINAL_CANADA_COMBINED','RANGE','','1','10']],
 D002:[['ORIGINAL_CANADA_COMBINED','EXACT_MULTIPLE','4','',''],['NON_SODA','EXACT_MULTIPLE','1','','']],
 D003:[['ORIGINAL_CANADA_COMBINED','EXACT_MULTIPLE','10','',''],['NON_SODA_NON_DASANI','EXACT_MULTIPLE','3','','']],
 D004:[['CANADA_SODA','MINIMUM','','11','']],
 D008:[['DOOGH_MILK','MINIMUM','','3','']],
 D012:[['ORIGINAL_CANADA_COMBINED','EXACT_MULTIPLE','3','',''],['DIVERSITY_EXCL_CORE','EXACT_MULTIPLE','1','','']],
 D013:[['ORIGINAL_CANADA_COMBINED','EXACT_MULTIPLE','25','',''],['NON_SODA_NON_DASANI','EXACT_MULTIPLE','5','','']],
};
function fixture(){
 const products=definitions.map(rawProduct);
 const eligibleByPlan={
   D001:['O','C'],D002:['O','C','V','L','M','D','W'],
   D003:['O','C','V','L','M','D'],
   D004:['C'],D008:['D','M'],
   D012:['O','C','V','L','D'],D013:['O','C','V','L','M','D']
 };
 const rows={
   Products:products,Discount_Plans:plans,
   Plan_Requirements:Object.entries(specs).flatMap(([plan_id,items])=>items.map(
    ([group_id,quantity_rule,packs_per_step,min_packs,max_packs])=>
       ({plan_id,group_id,quantity_rule,packs_per_step,min_packs,max_packs}))),
   Plan_Discount_Targets:Object.entries(specs).flatMap(([plan_id,items])=>items.map(
    ([group_id])=>({plan_id,group_id}))),
   Product_Plans:Object.entries(eligibleByPlan).flatMap(([plan_id,ids])=>ids.map(product_id=>({
     plan_id,product_id,is_active:'TRUE',approved_for_public:'TRUE'
   }))),
 };
 return publicData(rows,date);
}
const callbacks=view=>view.reply_markup.inline_keyboard.flat().map(x=>x.callback_data).filter(Boolean);
const has=(data,cart,id)=>eligiblePlans(cart.map(([product_id,qty])=>({product_id,qty})),data)
 .some(x=>x.plan.plan_id===id);

test('sales plan menu groups by percent; 15% shows one button and three distinct methods',()=>{
 const d=fixture(),groups=planCategories(d);
 assert.equal(groups.some(c=>c.name==='ترکیب اورجینال و کانادا'),false);
 const first=planList(d);
 assert.ok(callbacks(first).some(x=>x.startsWith('plan-group:')));
 const group=groups.find(c=>c.name==='نوشابه اورجینال و کانادا');
 const choices=planGroupList(d,group.index);
 assert.ok(callbacks(choices).includes('plan-rate:'+group.index+':15'));
 assert.match(choices.text,/درصد تخفیف/);
 const methods=planRateList(d,group.index,15);
 assert.ok(callbacks(methods).includes('plan:D003'));
 assert.ok(callbacks(methods).includes('plan:D012'));
 assert.ok(callbacks(methods).includes('plan:D013'));
 assert.ok(!d.plans.some(p=>p.plan_id==='D011'));
});
test('original and Canada models count together for 10%, 13% and 15%',()=>{
 const d=fixture();
 assert.ok(has(d,[['O',1]],'D001'));
 assert.ok(has(d,[['C',1]],'D001'));
 assert.ok(has(d,[['O',2],['C',2],['L',1]],'D002'));
 assert.ok(!has(d,[['O',4],['C',1]],'D002'));
 assert.ok(has(d,[['O',4],['C',6],['V',1],['L',2]],'D003'));
 assert.ok(!has(d,[['O',4],['C',6],['W',3]],'D003'));
});
test('15% 3+1 cannot reuse a soda pack as variety, 25+5 requires precise distinct counts',()=>{
 const d=fixture();
 assert.ok(has(d,[['O',2],['C',1],['V',1]],'D012'));
 assert.ok(!has(d,[['O',3],['C',1]],'D012'));
 assert.ok(!has(d,[['O',4]],'D012'));
 assert.ok(has(d,[['O',10],['C',15],['V',3],['D',2]],'D013'));
 assert.ok(!has(d,[['O',10],['C',14],['V',3],['D',2]],'D013'));
 assert.ok(!has(d,[['O',10],['C',15],['V',4]],'D013'));
 assert.ok(!has(d,[['O',25],['W',5]],'D013'));
 assert.ok(!has(d,[['O',50],['V',10]],'D013'));
});
test('20% milk and doogh accepts each alone, or a mixed basket, after 3 packs',()=>{
 const d=fixture();
 assert.ok(has(d,[['M',3]],'D008'));
 assert.ok(has(d,[['D',3]],'D008'));
 assert.ok(has(d,[['M',2],['D',1]],'D008'));
 assert.ok(!has(d,[['M',1],['D',1]],'D008'));
});
test('cart preserves distinct approved model/flavor and previews only whole-toman per-bottle prices',()=>{
 const d=fixture();
 const original=d.products.find(x=>x.product_id==='O');
 original.variants=['کوکاکولا','فانتا پرتقالی'];
 const choose=chooseFlavor(original);
 assert.ok(callbacks(choose).includes('cart-v:O:1'));
 let cart=changeQuantity([], 'O','کوکاکولا',1);
 cart=changeQuantity(cart,'O','فانتا پرتقالی',1);
 cart=changeQuantity(cart,'C','',2);
 assert.equal(cart.length,3);
 assert.equal(cart.reduce((x,y)=>x+y.qty,0),4);
 const summary=cartSummary(cart,d,{});
 assert.match(summary.text,/کوکاکولا/);
 assert.match(summary.text,/فانتا پرتقالی/);
 assert.match(summary.text,/هر بطری/);
 assert.doesNotMatch(summary.text,/قیمت هر بسته|ریال|قیمت نهایی قطعی|بهترین طرح ریالی:/);
 assert.equal(callbacks(summary).includes('cart-clear-confirm'),true);
 assert.equal(inGroup(d.products.find(x=>x.product_id==='W'),'NON_SODA_NON_DASANI'),false);
});
