import {card, fmt, discountedBottleToman, toman} from './bot-ui.js';
import {eligiblePlans, bestPlan, suggestions, inGroup} from './engine.js';

const btn=(text,callback_data)=>({text,callback_data});
const MAX_PER_PAGE=5;
export function chooseFlavor(product, page=1) {
  const variants=product.variants||[];
  if (!variants.length) return card('این محصول طعم مجاز برای انتخاب ندارد.', [
    [btn('🔙 محصول','product:'+product.product_id)],
  ]);
  const pages=Math.ceil(variants.length/MAX_PER_PAGE);
  if (!Number.isSafeInteger(page) || page<1 || page>pages) return card('صفحه نامعتبر است.');
  const start=(page-1)*MAX_PER_PAGE;
  const rows=variants.slice(start,start+MAX_PER_PAGE)
    .map((v,i)=>[btn(v,'cart-v:'+product.product_id+':'+(start+i+1))]);
  const nav=[];
  if(page>1)nav.push(btn('◀ قبلی','cart-flavors:'+product.product_id+':'+(page-1)));
  if(page<pages)nav.push(btn('بعدی ▶','cart-flavors:'+product.product_id+':'+(page+1)));
  if(nav.length)rows.push(nav);
  rows.push([btn('🔙 مشخصات','product:'+product.product_id)]);
  return card('🎨 طعم ' + product.product_name +
    '\nبرای افزودن یک بسته از طعم دلخواه انتخاب کنید.',rows);
}
function displayLine(x,product) {
  return '• '+product.product_name+(x.variant?' | '+x.variant:'')+' — '+fmt(x.qty)+' بسته';
}
export function cartSummary(cart,data,env={}) {
  if (!cart.length) return card('🛒 سبد خرید شما خالی است.\nاز بخش محصولات، مدل و طعم دلخواه را انتخاب کنید.', [
    [btn('📦 انتخاب محصولات','products:1')],
  ]);
  const lines=['🛒 سبد خرید شما'];
  const rows=[];
  let total=0;
  for(const [i,item] of cart.entries()) {
    const p=data.products.find(p=>p.product_id===item.product_id);
    if(!p)continue;
    total+=item.qty;
    lines.push(displayLine(item,p));
    if(i<15)rows.push([
      btn('➕','cart-plus:'+i),btn('➖','cart-minus:'+i)
    ]);
  }
  lines.push('\n📦 جمع: '+fmt(total)+' بسته');
  const valid=eligiblePlans(cart,data);
  if(valid.length) {
    lines.push('\n🎁 طرح‌های قابل استفاده برای اقلام مشمول:');
    for(const item of valid.slice(0,4))
      lines.push('• '+item.plan.plan_name+' | '+fmt(item.plan.discount_percent)+'٪');
    const winner=bestPlan(cart,data,env).winner;
    if(winner) {
      lines.push('\n✅ طرح با بیشترین صرفه‌جویی ریالی برای اقلام مشمول: '+winner.plan.plan_name);
      lines.push('صرفه‌جویی اقلام مشمول: '+toman(winner.money.savingIRR));
    } else lines.push('📌 انتخاب بهترین طرح ریالی تا تأیید قیمت نهایی و قوانین محاسبه ممکن نیست.');
    const quoted=winner || [...valid].sort((a,b)=>Number(b.plan.discount_percent)-Number(a.plan.discount_percent))[0];
    const unique=[...new Map(quoted.items.map(x=>[x.product_id,x.product])).values()];
    if(unique.length) {
      lines.push('\n💰 قیمت مشروط هر بطری با «'+quoted.plan.plan_name+'»:');
      for(const p of unique.slice(0,8)) {
        const q=p.box_base_price &&
          discountedBottleToman(p.box_base_price.amountToman,quoted.plan.discount_percent,p.units_per_pack);
        if(q)lines.push('• '+p.product_name+': '+q);
      }
      lines.push('قیمت‌های بالا فقط برای اقلام مشمول و پس از احراز شرایط همین طرح هستند.');
    }
  } else lines.push('\nهنوز ترکیب واجد شرایط طرحی کامل نشده است.');
  const gaps=suggestions(cart,data).slice(0,3);
  if(gaps.length){
    lines.push('\n💡 برای رسیدن به طرح‌های دیگر:');
    for(const [i,s] of gaps.entries()) {
      lines.push('• '+s.plan.plan_name+': '+s.adds.map(a=>fmt(a.packs)+' بسته '+groupLabel(a.group_id)).join(' + '));
      rows.push([btn('➕ تکمیل '+fmt(s.plan.discount_percent)+'٪ ('+fmt(s.totalAdded)+' بسته)',
        'cart-gap:'+s.plan.plan_id+':0:1')]);
    }
  }
  rows.push([btn('📦 ادامه انتخاب محصولات','products:1')]);
  rows.push([btn('🗑 پاک‌کردن سبد','cart-clear-confirm')]);
  return card(lines.join('\n'),rows);
}
function groupLabel(id) {
  return ({
    ORIGINAL_CANADA_COMBINED:'نوشابه اورجینال/کانادا',
    DIVERSITY_EXCL_CORE:'تنوع مجاز',
    NON_SODA:'تنوع غیرنوشابه',
    NON_SODA_NON_DASANI:'تنوع مجاز',
    CANADA_SODA:'نوشابه کانادا',
    DASANI_WATER:'آب دسانی',
    DOOGH_MILK:'شیر و دوغ',
  })[id]||'محصول مجاز';
}
export function missingGroupProducts(cart,data,planId,gapIndex=0,page=1) {
  const candidate=suggestions(cart,data).find(s=>s.plan.plan_id===planId);
  if(!candidate||!Number.isSafeInteger(gapIndex)||!candidate.adds[gapIndex])
    return card('سبد به‌روزرسانی شده است؛ پیشنهادها را دوباره بررسی کنید.',[
      [btn('🛒 سبد خرید','cart')],
    ]);
  const missing=candidate.adds[gapIndex];
  const ids=new Set(data.links.filter(l=>l.plan_id===planId).map(l=>l.product_id));
  const products=data.products.filter(p=>ids.has(p.product_id)&&inGroup(p,missing.group_id));
  const pages=Math.ceil(products.length/MAX_PER_PAGE);
  if(!products.length||!Number.isSafeInteger(page)||page<1||page>pages)
    return card('محصول عمومی واجد شرایط برای تکمیل طرح یافت نشد.',[
      [btn('🛒 سبد خرید','cart')],
    ]);
  const rows=products.slice((page-1)*MAX_PER_PAGE,page*MAX_PER_PAGE)
    .map(p=>[btn(p.product_name,'cart-add:'+p.product_id)]);
  const nav=[];
  if(page>1)nav.push(btn('◀ قبلی','cart-gap:'+planId+':'+gapIndex+':'+(page-1)));
  if(page<pages)nav.push(btn('بعدی ▶','cart-gap:'+planId+':'+gapIndex+':'+(page+1)));
  if(nav.length)rows.push(nav);
  if(candidate.adds.length>1) rows.push(candidate.adds.filter((_,i)=>i!==gapIndex)
    .map(a=>btn('➕ '+groupLabel(a.group_id),'cart-gap:'+planId+':'+candidate.adds.indexOf(a)+':1')));
  rows.push([btn('🛒 سبد خرید','cart')]);
  return card('➕ تکمیل '+candidate.plan.plan_name+
    '\nهنوز '+fmt(missing.packs)+' بسته '+groupLabel(missing.group_id)+' لازم است.'+
    '\nمی‌توانید چند مدل و طعم مختلف انتخاب کنید؛ هر بار یک بسته اضافه می‌شود.',rows);
}
export function confirmClear() {
  return card('🗑 مطمئن هستید که سبد خرید خالی شود؟',[
    [btn('بله، پاک شود','cart-clear'),btn('انصراف','cart')],
  ]);
}
