import test from 'node:test';
import assert from 'node:assert/strict';
import {publicData,eligiblePlans,bestPlan,suggestions} from '../src/engine.js';

const today='2026-11-06';
function product(id,group,base=''){
  return {product_id:id,product_name:id,group_id:group,group_verified:'TRUE',
    publish_status:'PUBLISHED',approved_for_public:'TRUE',base_price_irr:base,
    base_price_basis:base?'PACK_WITH_TAX':''};
}
function plan(id,percent,max=''){
  return {plan_id:id,plan_name:id,discount_percent:String(percent),max_multiplier:max,
    is_active:'TRUE',approved_for_public:'TRUE',review_status:'APPROVED',
    valid_from:'2026-11-01',valid_to:'2026-12-30'};
}
const products=[
  product('CAN','CANADA_SODA','120000'),
  product('LEM','KHOSH_LEMONADE','80000'),
  product('ORG','ORIGINAL_SODA','150000'),
  product('OTHER','KHOSH_LEMONADE','80000'),
  product('WATER','DASANI_WATER','50000')
];
const plans=[plan('D001',10),plan('D002',13,'2'),plan('D003',15),plan('D004',16),plan('D005',23),plan('D006',20)];
const reqs=[
  ['D001','ORIGINAL_SODA','RANGE','',1,10],
  ['D002','ORIGINAL_SODA','EXACT_MULTIPLE',4,'',''],
  ['D002','NON_SODA','EXACT_MULTIPLE',1,'',''],
  ['D003','ORIGINAL_SODA','EXACT_MULTIPLE',10,'',''],
  ['D003','NON_SODA_NON_DASANI','EXACT_MULTIPLE',3,'',''],
  ['D004','CANADA_SODA','MINIMUM','',11,''],
  ['D005','CANADA_SODA','EXACT_MULTIPLE',10,'',''],
  ['D005','KHOSH_LEMONADE','EXACT_MULTIPLE',5,'',''],
  ['D006','DASANI_WATER','MINIMUM','',11,'']
].map(([plan_id,group_id,quantity_rule,packs_per_step,min_packs,max_packs])=>
  ({plan_id,group_id,quantity_rule,packs_per_step:String(packs_per_step),min_packs:String(min_packs),max_packs:String(max_packs)}));
const targetGroups={
  D001:['ORIGINAL_SODA'],D002:['ORIGINAL_SODA','NON_SODA'],
  D003:['ORIGINAL_SODA','NON_SODA_NON_DASANI'],D004:['CANADA_SODA'],
  D005:['CANADA_SODA','KHOSH_LEMONADE'],D006:['DASANI_WATER']
};
function seed(){
  return {Products:products.map(x=>({...x})),Discount_Plans:plans.map(x=>({...x})),Product_Plans:products.flatMap(p=>
    plans.map(x=>({product_id:p.product_id,plan_id:x.plan_id,is_active:'TRUE',approved_for_public:'TRUE'}))),
    Plan_Requirements:reqs,
    Plan_Discount_Targets:Object.entries(targetGroups).flatMap(([plan_id,groups])=>
      groups.map(group_id=>({plan_id,group_id})))};
}
const cart=(...pairs)=>pairs.map(([product_id,qty])=>({product_id,qty}));
const ids=(items,data)=>eligiblePlans(items,data).map(x=>x.plan.plan_id);
test('default DRAFT rows, missing date, unpublished product and unmapped link stay private',()=>{
  const raw=seed();
  raw.Discount_Plans[0]={...raw.Discount_Plans[0],approved_for_public:'FALSE'};
  raw.Discount_Plans[1]={...raw.Discount_Plans[1],valid_to:''};
  raw.Products[0]={...raw.Products[0],publish_status:'DRAFT'};
  raw.Product_Plans=raw.Product_Plans.filter(x=>!(x.product_id==='ORG'&&x.plan_id==='D003'));
  const data=publicData(raw,today);
  assert.ok(!data.plans.some(x=>x.plan_id==='D001'||x.plan_id==='D002'));
  assert.ok(!data.products.some(x=>x.product_id==='CAN'));
  assert.deepEqual(ids(cart(['ORG',10],['OTHER',3]),data),[]);
});
test('4+1 and 8+2 allowed but 12+3 forbidden',()=>{
  const d=publicData(seed(),today);
  assert.ok(ids(cart(['ORG',4],['OTHER',1]),d).includes('D002'));
  assert.ok(ids(cart(['ORG',8],['OTHER',2]),d).includes('D002'));
  assert.ok(!ids(cart(['ORG',12],['OTHER',3]),d).includes('D002'));
});
test('10+3/100+30 and 10+5/100+50 exact ratios',()=>{
  const d=publicData(seed(),today);
  assert.ok(ids(cart(['ORG',10],['OTHER',3]),d).includes('D003'));
  assert.ok(ids(cart(['ORG',100],['OTHER',30]),d).includes('D003'));
  assert.ok(!ids(cart(['ORG',10],['WATER',3]),d).includes('D003'));
  assert.ok(ids(cart(['CAN',10],['LEM',5]),d).includes('D005'));
  assert.ok(ids(cart(['CAN',100],['LEM',50]),d).includes('D005'));
  assert.ok(!ids(cart(['CAN',11],['LEM',5]),d).includes('D005'));
});
test('10 Canada has no 16 percent, offers 1 Canada or 5 lemonade',()=>{
  const d=publicData(seed(),today),items=cart(['CAN',10]);
  assert.ok(!ids(items,d).includes('D004'));
  const ss=suggestions(items,d);
  assert.ok(ss.some(x=>x.plan.plan_id==='D004'&&x.adds[0].packs===1));
  assert.ok(ss.some(x=>x.plan.plan_id==='D005'&&x.adds[0].packs===5));
  assert.ok(ids(cart(['CAN',11]),d).includes('D004'));
});
test('missing company price policy yields no claimed monetary winner',()=>{
  const d=publicData(seed(),today),items=cart(['CAN',10],['LEM',5]);
  assert.equal(bestPlan(items,d,{}).winner,null);
  assert.equal(bestPlan(items,d,{PRICE_POLICY_APPROVED:'true',ROUNDING_RULE:'HALF_UP_IRR'}).winner.plan.plan_id,'D005');
});
test('no plan stacking or partial exact-step allocation',()=>{
  const d=publicData(seed(),today);
  assert.ok(!ids(cart(['ORG',11],['OTHER',3]),d).includes('D003'));
  const x=bestPlan(cart(['CAN',11],['ORG',4],['OTHER',1]),d,{});
  assert.equal(x.winner,null);
});
