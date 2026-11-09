import test from 'node:test';
import assert from 'node:assert/strict';
import {publicData,eligiblePlans,bestPlan,suggestions} from '../src/engine.js';

const today='2026-11-06';
function product(id,group,base=''){
  return {product_id:id,product_name:id,group_id:group,group_verified:'TRUE',
    publish_status:'PUBLISHED',approved_for_public:'TRUE',base_price_irr:base,
    base_price_basis:base?'PACK_WITH_TAX':'',
    final_price_approved_for_public:base?'TRUE':'FALSE'};
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
    Plan_Requirements:reqs.map(r=>({...r})),
    Plan_Discount_Targets:Object.entries(targetGroups).flatMap(([plan_id,groups])=>
      groups.map(group_id=>({plan_id,group_id})))};
}
const cart=(...pairs)=>pairs.map(([product_id,qty])=>({product_id,qty}));
const ids=(items,data)=>eligiblePlans(items,data).map(x=>x.plan.plan_id);
test('default DRAFT rows, missing date, unpublished product and unmapped link stay private',()=>{
  const raw=seed();
  raw.Discount_Plans[0]={...raw.Discount_Plans[0],approved_for_public:'FALSE'};
  raw.Discount_Plans[1]={...raw.Discount_Plans[1],valid_from:''};
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

test('consumer price requires explicit approval, valid dates, and a declared unit',()=>{
  const raw=seed();
  Object.assign(raw.Products[0],{consumer_price_irr:'95000',consumer_price_basis:'UNIT',
    consumer_price_approved_for_public:'TRUE',consumer_price_valid_from:'2026-11-01',
    consumer_price_valid_to:'2026-11-30'});
  assert.deepEqual(publicData(raw,today).products[0].consumer_price,{amountIRR:'95000',basis:'UNIT'});
  raw.Products[0].consumer_price_approved_for_public='FALSE';
  assert.equal(publicData(raw,today).products[0].consumer_price,null);
  raw.Products[0].consumer_price_approved_for_public='TRUE';
  raw.Products[0].consumer_price_valid_to='2026-11-05';
  assert.equal(publicData(raw,today).products[0].consumer_price,null);
  raw.Products[0].consumer_price_valid_to='2026-11-30';
  raw.Products[0].consumer_price_basis='';
  assert.equal(publicData(raw,today).products[0].consumer_price,null);
});
test('unapproved buying price is suppressed even when plan is valid and global policy is enabled',()=>{
  const raw=seed();
  raw.Products[0].final_price_approved_for_public='FALSE';
  const d=publicData(raw,today);
  assert.equal(d.products[0].base_price_irr,null);
  assert.equal(bestPlan(cart(['CAN',10],['LEM',5]),d,{
    PRICE_POLICY_APPROVED:'true',ROUNDING_RULE:'HALF_UP_IRR'
  }).winner,null);
});
test('approved plan returns per-product net price and exact totals in IRR',()=>{
  const d=publicData(seed(),today);
  const outcome=bestPlan(cart(['CAN',10],['LEM',5]),d,{
    PRICE_POLICY_APPROVED:'true',ROUNDING_RULE:'HALF_UP_IRR'
  });
  assert.equal(outcome.winner.plan.plan_id,'D005');
  assert.equal(outcome.winner.money.totalIRR,'1232000');
  assert.equal(outcome.winner.money.savingIRR,'368000');
  assert.deepEqual(outcome.winner.money.itemPrices,[
    {product_id:'CAN',qty:10,finalPricePerPackIRR:'92400',lineTotalIRR:'924000'},
    {product_id:'LEM',qty:5,finalPricePerPackIRR:'61600',lineTotalIRR:'308000'}
  ]);
});
test('invalid calendar dates cannot approve a plan',()=>{
  const raw=seed();
  raw.Discount_Plans[0].valid_from='2026-11-31';
  assert.ok(!publicData(raw,today).plans.some(x=>x.plan_id==='D001'));
});

test('base_price_per_box overrides the older base price and discounts the exact box amount',()=>{
  const raw=seed();
  const org=raw.Products.find(x=>x.product_id==='ORG');
  Object.assign(org,{units_per_pack:'6',base_price_irr:'999999',
    base_price_per_box:'654107',box_unit_base_price:'109017.83333333333',
    final_price_approved_for_public:'TRUE',base_price_basis:'PACK_WITH_TAX'});
  const d=publicData(raw,today);
  assert.equal(d.products.find(x=>x.product_id==='ORG').base_price_irr,'6541070');
  const offer=bestPlan(cart(['ORG',1]),d,{
    PRICE_POLICY_APPROVED:'true',ROUNDING_RULE:'HALF_UP_IRR'
  });
  assert.equal(offer.winner.plan.plan_id,'D001');
  assert.equal(offer.winner.money.itemPrices[0].finalPricePerPackIRR,'5886963');
  assert.equal(offer.winner.money.savingIRR,'654107');
});
test('integer rounded box unit is tolerated, but cannot replace the exact box amount',()=>{
  const raw=seed();
  const org=raw.Products.find(x=>x.product_id==='ORG');
  Object.assign(org,{units_per_pack:'6',base_price_irr:'',
    base_price_per_box:'883929',box_unit_base_price:'147322',base_price_basis:'PACK_WITH_TAX'});
  assert.equal(publicData(raw,today).products.find(x=>x.product_id==='ORG').base_price_irr,'8839290');
  org.box_unit_base_price='147700';
  assert.equal(publicData(raw,today).products.find(x=>x.product_id==='ORG').base_price_irr,null);
});
test('box base cannot be used with missing unit, invalid money, or unapproved tax basis',()=>{
  const raw=seed(),p=raw.Products.find(x=>x.product_id==='ORG');
  Object.assign(p,{units_per_pack:'6',base_price_per_box:'654107',
    box_unit_base_price:'109017.83333333333',base_price_basis:''});
  let d=publicData(raw,today);
  assert.equal(d.products.find(x=>x.product_id==='ORG').base_price_irr,null);
  p.base_price_basis='PACK_WITH_TAX';
  p.box_unit_base_price='';
  d=publicData(raw,today);
  assert.equal(d.products.find(x=>x.product_id==='ORG').base_price_irr,null);
  p.box_unit_base_price='109017.83333333333';
  p.base_price_per_box='654107.5';
  d=publicData(raw,today);
  assert.equal(d.products.find(x=>x.product_id==='ORG').base_price_irr,null);
  p.base_price_per_box='654107';
  p.final_price_approved_for_public='FALSE';
  d=publicData(raw,today);
  assert.equal(d.products.find(x=>x.product_id==='ORG').base_price_irr,null);
});
test('source-like 24-pack fractional unit formula agrees with integer box base',()=>{
  const raw=seed(),p=raw.Products.find(x=>x.product_id==='ORG');
  Object.assign(p,{units_per_pack:'24',base_price_per_box:'1178573',
    box_unit_base_price:'49107.208333333336',base_price_irr:'',
    base_price_basis:'PACK_WITH_TAX'});
  assert.equal(publicData(raw,today).products.find(x=>x.product_id==='ORG').base_price_irr,'11785730');
});

function allPlanSeed(){
  const raw=seed();
  for(const [id,group] of [
    ['ENERGY','ENERGY_DRINK'],['DOOGH','DOOGH'],['MILK','MILK'],
    ['OTHER_WATER','WATER_ALL'],['MALT','DIVERSITY'],['CAN2','CANADA_SODA']
  ])raw.Products.push(product(id,group,'100000'));
  const newPlans=[
    ['D007',33,''],['D008',20,''],['D009',33,''],['D010',25,''],
    ['D011',12,''],['D012',15,'1']
  ];
  const newReqs=[
    ['D007','ENERGY_DRINK','MINIMUM','',3,''],
    ['D008','DOOGH_MILK','MINIMUM','',3,''],
    ['D009','DIVERSITY_EXCL_CORE','MINIMUM','',12,''],
    ['D010','DIVERSITY_EXCL_CORE','RANGE','',3,10],
    ['D011','ORIGINAL_CANADA_COMBINED','MINIMUM','',26,''],
    ['D012','ORIGINAL_SODA','EXACT_MULTIPLE',3,'',''],
    ['D012','VARIETY_NON_WATER_NON_MILK','EXACT_MULTIPLE',1,'','']
  ];
  raw.Discount_Plans.push(...newPlans.map(([id,percent,max])=>plan(id,percent,max)));
  raw.Plan_Requirements.push(...newReqs.map(([plan_id,group_id,quantity_rule,packs_per_step,min_packs,max_packs])=>({
    plan_id,group_id,quantity_rule,packs_per_step:String(packs_per_step),
    min_packs:String(min_packs),max_packs:String(max_packs)
  })));
  raw.Plan_Discount_Targets.push(...newReqs.map(([plan_id,group_id])=>({plan_id,group_id})));
  raw.Product_Plans.push(...raw.Products.flatMap(p=>newPlans.map(([plan_id])=>({
    product_id:p.product_id,plan_id,is_active:'TRUE',approved_for_public:'TRUE'
  }))));
  return raw;
}
test('all twelve plan IDs and their percentages are read from approved Discount_Plans',()=>{
  const d=publicData(allPlanSeed(),today);
  assert.deepEqual(d.plans.map(p=>[p.plan_id,Number(p.discount_percent)]),[
    ['D001',10],['D002',13],['D003',15],['D004',16],['D005',23],['D006',20],
    ['D007',33],['D008',20],['D009',33],['D010',25],['D011',12],['D012',15]
  ]);
});
test('plan D007: approved energy drink requires 3 packs and excludes other groups',()=>{
  const d=publicData(allPlanSeed(),today);
  assert.ok(!ids(cart(['ENERGY',2]),d).includes('D007'));
  assert.ok(ids(cart(['ENERGY',3]),d).includes('D007'));
  assert.ok(!ids(cart(['DOOGH',3]),d).includes('D007'));
});
test('plan D008: milk plus doogh aggregate to 3 packs without double-counting',()=>{
  const d=publicData(allPlanSeed(),today);
  assert.ok(ids(cart(['DOOGH',2],['MILK',1]),d).includes('D008'));
  assert.ok(ids(cart(['MILK',3]),d).includes('D008'));
  assert.ok(!ids(cart(['DOOGH',1],['MILK',1]),d).includes('D008'));
});
test('plans D009 and D010: 3-10 and 12+, excluding original, Canada, water, milk',()=>{
  const d=publicData(allPlanSeed(),today);
  assert.ok(ids(cart(['MALT',3]),d).includes('D010'));
  assert.ok(ids(cart(['MALT',10]),d).includes('D010'));
  assert.ok(!ids(cart(['MALT',11]),d).includes('D010'));
  assert.ok(!ids(cart(['MALT',11]),d).includes('D009'));
  assert.ok(ids(cart(['MALT',12]),d).includes('D009'));
  assert.ok(ids(cart(['MALT',3],['ENERGY',2]),d).includes('D010'));
  assert.ok(!ids(cart(['ORG',10],['CAN',10],['OTHER_WATER',10],['MILK',10]),d).includes('D009'));
  assert.ok(ids(cart(['MALT',12],['ORG',10],['MILK',10]),d).includes('D009'));
  const eligible=eligiblePlans(cart(['MALT',12],['ORG',10],['MILK',10]),d).find(x=>x.plan.plan_id==='D009');
  assert.deepEqual(eligible.items.map(x=>x.product_id),['MALT']);
});
test('plan D011: 26 boxes total original + Canada, no water, no duplicate count',()=>{
  const d=publicData(allPlanSeed(),today);
  assert.ok(!ids(cart(['ORG',12],['CAN',13]),d).includes('D011'));
  assert.ok(ids(cart(['ORG',12],['CAN',14]),d).includes('D011'));
  assert.ok(ids(cart(['ORG',26]),d).includes('D011'));
  assert.ok(!ids(cart(['ORG',25],['WATER',1]),d).includes('D011'));
});
test('plan D012: 3 original plus 1 independent eligible pack, no overlap or water/milk',()=>{
  const d=publicData(allPlanSeed(),today);
  assert.ok(!ids(cart(['ORG',3]),d).includes('D012'));
  assert.ok(ids(cart(['ORG',3],['CAN',1]),d).includes('D012'));
  assert.ok(ids(cart(['ORG',4]),d).includes('D012'));
  assert.ok(ids(cart(['ORG',3],['ENERGY',1]),d).includes('D012'));
  assert.ok(!ids(cart(['ORG',3],['MILK',1]),d).includes('D012'));
  assert.ok(!ids(cart(['ORG',3],['OTHER_WATER',1]),d).includes('D012'));
  assert.ok(!ids(cart(['ORG',3],['CAN',2]),d).includes('D012'));
  assert.ok(!ids(cart(['ORG',2],['CAN',2]),d).includes('D012'));
  const four=eligiblePlans(cart(['ORG',3],['CAN',1]),d).find(x=>x.plan.plan_id==='D012');
  assert.equal(four.items.reduce((n,x)=>n+x.qty,0),4);
});
test('new plan approval gates remain closed for D007-D012 draft sheets',()=>{
  const raw=allPlanSeed();
  for(const p of raw.Discount_Plans.filter(p=>Number(p.plan_id.slice(1))>=7)){
    p.is_active='FALSE';p.approved_for_public='FALSE';p.review_status='DRAFT';p.valid_from='';p.valid_to='';
  }
  const d=publicData(raw,today);
  assert.equal(d.plans.length,6);
  assert.ok(!d.plans.some(p=>p.plan_id==='D007'||p.plan_id==='D012'));
});

test('explicitly published plan with verified start and open end is listed, not a false expiry',()=>{
  const raw=seed();raw.Discount_Plans[0].valid_to='';
  assert.ok(publicData(raw,'2026-11-08').plans.some(p=>p.plan_id==='D001'));
  raw.Discount_Plans[0].valid_from='';
  assert.ok(!publicData(raw,'2026-11-08').plans.some(p=>p.plan_id==='D001'));
  raw.Discount_Plans[0].valid_from='2026-11-08';
  raw.Discount_Plans[0].valid_to='2026-10-02';
  assert.ok(!publicData(raw,'2026-11-08').plans.some(p=>p.plan_id==='D001'));
});
test('consumer price is published from approved current start without invented end date',()=>{
  const raw=seed();
  Object.assign(raw.Products[0],{consumer_price_irr:'122000',consumer_price_basis:'UNIT',
    consumer_price_approved_for_public:'TRUE',consumer_price_valid_from:'2026-11-08',
    consumer_price_valid_to:''});
  const d=publicData(raw,'2026-11-08');
  assert.equal(d.products[0].consumer_price.amountIRR,'122000');
  assert.equal(publicData(raw,'2026-11-07').products[0].consumer_price,null);
});
test('base box price independently approved is public, without claiming tax verification',()=>{
  const raw=seed(),p=raw.Products[2];
  Object.assign(p,{base_price_per_box:'654107',box_unit_base_price:'109017.83333333333',
    units_per_pack:'6',base_box_price_approved_for_public:'TRUE'});
  let d=publicData(raw,today);
  assert.deepEqual(d.products.find(x=>x.product_id==='ORG').box_base_price,
    {amountToman:'654107',unitRawToman:'109017.83333333333',basis:'PACK',taxVerified:false});
  assert.equal(d.products.find(x=>x.product_id==='ORG').final_price_approved_for_public,true);
  p.final_price_approved_for_public='FALSE';
  d=publicData(raw,today);
  assert.equal(d.products.find(x=>x.product_id==='ORG').base_price_irr,null);
  assert.ok(d.products.find(x=>x.product_id==='ORG').box_base_price);
  p.base_box_price_approved_for_public='FALSE';
  assert.equal(publicData(raw,today).products.find(x=>x.product_id==='ORG').box_base_price,null);
});
test('only public, parent-approved product variants appear without internal notes',()=>{
  const raw=seed();
  raw.Product_Variants=[
    {product_id:'ORG',variant_name:'فانتا لیمو',approved_for_public:'TRUE',review_notes:'SECRET'},
    {product_id:'ORG',variant_name:'فانتا پرتقالی',approved_for_public:'FALSE'},
    {product_id:'CAN',variant_name:'محرمانه',approved_for_public:'TRUE'}
  ];
  raw.Products.find(x=>x.product_id==='CAN').approved_for_public='FALSE';
  const d=publicData(raw,today);
  assert.deepEqual(d.products.find(x=>x.product_id==='ORG').variants,['فانتا لیمو']);
  assert.ok(!JSON.stringify(d).includes('SECRET'));
  assert.ok(!d.products.some(x=>x.product_id==='CAN'));
});

test('updated Products.variants_json only publishes entries approved individually', () => {
  const raw = seed();
  const p = raw.Products.find(x => x.product_id === 'ORG');
  p.flavor = 'محرمانه: از متن خام نباید خوانده شود';
  p.variants_json = JSON.stringify([
    {variant_id:'V-1',product_id:'ORG',variant_name:'کوکاکولا',approved_for_public:false,review_notes:'INTERNAL_SECRET'},
    {variant_id:'V-2',product_id:'ORG',variant_name:'اسپرایت',approved_for_public:true,review_notes:'INTERNAL_SECRET'},
    {variant_id:'V-3',product_id:'ORG',variant_name:'اسپرایت',approved_for_public:true},
    {variant_id:'V-4',product_id:'OTHER',variant_name:'طعم محصول دیگر',approved_for_public:true},
    {variant_id:'V-5',product_id:'ORG',product_name:'اشتباه',variant_name:'مغایرت عنوان',approved_for_public:true},
  ]);
  const publicView = publicData(raw,today);
  const org = publicView.products.find(x => x.product_id === 'ORG');
  assert.deepEqual(org.variants, ['اسپرایت']);
  assert.equal(org.flavor,undefined);
  assert.doesNotMatch(JSON.stringify(publicView),/INTERNAL_SECRET|محرمانه|طعم محصول دیگر|مغایرت عنوان|کوکاکولا/);
  p.variants_json = '{json-broken';
  assert.deepEqual(publicData(raw,today).products.find(x=>x.product_id==='ORG').variants,[]);
  p.variants_json = JSON.stringify({variant_name:'سرّی',approved_for_public:true});
  assert.deepEqual(publicData(raw,today).products.find(x=>x.product_id==='ORG').variants,[]);
});
test('unnamed and unpublished catalog rows cannot appear in product menus', () => {
  const raw=seed();
  raw.Products.push({product_id:'P001',product_name:'',publish_status:'PUBLISHED',approved_for_public:'TRUE'});
  raw.Products.push({product_id:'P002',product_name:'  ',publish_status:'PUBLISHED',approved_for_public:'TRUE'});
  raw.Products.push({product_id:'P003',product_name:'خصوصی',publish_status:'PUBLISHED',approved_for_public:'FALSE'});
  const data=publicData(raw,today);
  assert.ok(!data.products.some(p=>['P001','P002','P003'].includes(p.product_id)));
});
