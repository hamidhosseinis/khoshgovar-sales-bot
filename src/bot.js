import {sheetCatalog} from './sheets.js';
import { CONSULTATION_BUTTON_TEXT } from './consultation.js';
import {allowed,approvedProduct,bestPlan,eligiblePlans,suggestions} from './engine.js';

const keyboard={keyboard:[
  [{text:'📦 محصولات'},{text:'🏷 طرح‌های عمومی'}],
  [{text:'💰 قیمت‌ها'},{text:'🛒 سبد خرید'}],
  [{text:'💡 پیشنهاد تخفیف بیشتر'}],
  [{text:CONSULTATION_BUTTON_TEXT}],
  [{text:'ℹ️ راهنما'}],
],resize_keyboard:true};
const groupNames={
  ORIGINAL_SODA:'نوشابه اورجینال',CANADA_SODA:'نوشابه کانادا',
  NON_SODA:'محصول غیرنوشابه',NON_SODA_NON_DASANI:'محصول غیرنوشابه و غیردسانی',
  KHOSH_LEMONADE:'لیموناد خوشگوار',DASANI_WATER:'آب دسانی',
  ENERGY_DRINK:'انرژی‌زا',DOOGH_MILK:'دوغ یا شیر',
  DIVERSITY_EXCL_CORE:'تنوع مجاز به‌جز اورجینال، کانادا، آب و شیر',
  ORIGINAL_CANADA_COMBINED:'نوشابه اورجینال یا کانادا',
  VARIETY_NON_WATER_NON_MILK:'تنوع به‌جز آب و شیر'
};
function reply(text,extras={}) {return {text,reply_markup:extras.reply_markup||keyboard,...extras};}
const fmt=n=>Number(n).toLocaleString('fa-IR');
function consumerText(p) {
  if (!p.consumer_price) return 'قیمت مصرف‌کننده: در داده‌های قابل انتشار ثبت نشده';
  const unit = p.consumer_price.basis === 'PACK' ? 'هر بسته' : 'هر عدد';
  return 'قیمت مصرف‌کننده ' + unit + ': ' + fmt(p.consumer_price.amountIRR) + ' ریال';
}
function boxBaseText(p) {
  if (!p.box_base_price) return 'قیمت پایه باکس: ثبت نشده یا کنترل مبلغ نامعتبر است';
  return 'قیمت پایه هر باکس (مبنای شیت): ' + fmt(p.box_base_price.amountIRR) +
    ' ریال — شمول مالیات تأیید نشده';
}
const pageSize=10;
function pageOf(data,which,page) {
  const pages=Math.ceil(data.length/pageSize);
  if(!Number.isSafeInteger(page)||page<1||page>pages) return null;
  return {items:data.slice((page-1)*pageSize,page*pageSize),pages};
}
function priceList(data,page=1) {
  if (!data.products.length) return reply('هنوز محصولی در فهرست عمومی ثبت نشده است.');
  const view=pageOf(data.products,'prices',page);
  if(!view) return reply('شماره صفحه قیمت‌ها نامعتبر است.');
  const out=['💰 فهرست قیمت‌های ثبت‌شده در شیت — صفحه '+fmt(page)+' از '+fmt(view.pages)];
  for (const p of view.items)
    out.push('• '+p.product_id+' — '+p.product_name+'\n'+consumerText(p)+
      '\n'+boxBaseText(p));
  if(page<view.pages)out.push('صفحه بعد: /prices '+(page+1));
  if(page>1)out.push('صفحه قبل: /prices '+(page-1));
  out.push('مقادیر پایه برای اطلاع‌اند؛ قیمت قطعی پس از تخفیف به قانون مالیات و گردکردن نیاز دارد.');
  return reply(out.join('\n\n'));
}
const maxQty=10000;
function arg(text,action) {
  const match=text.match(new RegExp('^/'+action+'\\s+([A-Za-z0-9_-]{1,40})\\s+([0-9]{1,5})$','i'));
  return match?{id:match[1],qty:Number(match[2])}:null;
}
function isDb(env){return Boolean(env.CART_DB?.prepare);}
async function cartFor(db,id){
  const r=await db.prepare('SELECT product_id, qty FROM cart_items WHERE chat_id=? LIMIT 100')
    .bind(String(id)).all();
  return (r.results||[]).map(x=>({product_id:x.product_id,qty:Number(x.qty)}));
}
async function changeCart(db,id,pid,delta){
  const row=await db.prepare('SELECT qty FROM cart_items WHERE chat_id=? AND product_id=?')
    .bind(String(id),pid).first();
  const old=Number(row?.qty||0);
  const total=old+delta;
  if(total>maxQty) return false;
  if(total<=0){await db.prepare('DELETE FROM cart_items WHERE chat_id=? AND product_id=?')
    .bind(String(id),pid).run();}
  else await db.prepare('INSERT INTO cart_items (chat_id,product_id,qty) VALUES (?,?,?) ON CONFLICT(chat_id,product_id) DO UPDATE SET qty=excluded.qty')
    .bind(String(id),pid,total).run();
  return true;
}
function productList(data,page=1) {
  if(!data.products.length)return reply('هنوز محصولی در فهرست عمومی ثبت نشده است.');
  const view=pageOf(data.products,'products',page);
  if(!view)return reply('شماره صفحه محصولات نامعتبر است.');
  const lines=['📦 محصولات ثبت‌شده — صفحه '+fmt(page)+' از '+fmt(view.pages)];
  for(const p of view.items){
    lines.push('• '+p.product_id+' — '+p.product_name+
      (p.units_per_pack?' | '+p.units_per_pack+' عدد در باکس':'')+
      (p.variants.length?' | طعم‌ها: '+p.variants.join('، '):'')+
      '\n'+consumerText(p)+'\n'+boxBaseText(p)+
      '\nجزئیات: /product '+p.product_id);
  }
  if(page<view.pages)lines.push('صفحه بعد: /products '+(page+1));
  if(page>1)lines.push('صفحه قبل: /products '+(page-1));
  return reply(lines.join('\n\n'));
}
function planList(data){
  if(!data.plans.length)return reply('در حال حاضر طرح دارای تأیید انتشار و بازه اعتبار ثبت‌شده موجود نیست.');
  const out=['🏷 طرح‌های عمومی در بازه اعتبار اعلام‌شده:'];
  for(const p of data.plans.slice(0,40))
    out.push('• '+p.plan_name+' — '+fmt(p.discount_percent)+'٪\n'+p.conditions);
  out.push('اعمال هر طرح تنها پس از تطبیق محصول، گروه، تعداد و مجوز انتشار انجام می‌شود.');
  return reply(out.join('\n\n'));
}
function cartText(items,data,env){
  if(!items.length)return reply('🛒 سبد خرید خالی است.\nبرای افزودن: /add P001 1\n(فقط شناسه محصول عمومی و تأییدشده قابل انتخاب است.)');
  const products=new Map(data.products.map(p=>[p.product_id,p]));
  const lines=['🛒 سبد خرید:'];
  for(const x of items) if(products.has(x.product_id)) {
    const p = products.get(x.product_id);
    lines.push('• '+p.product_name+' — '+fmt(x.qty)+' بسته'+
      ' | کاهش: /remove '+x.product_id+' 1');
    if (p.consumer_price) lines.push('  '+consumerText(p));
    if (p.box_base_price) lines.push('  '+boxBaseText(p));
  }
  const evaluation=bestPlan(items,data,env);
  if(evaluation.list.length){
    lines.push('\nطرح‌های منطبق با ترکیب دقیق فعلی:');
    for(const x of evaluation.list)
      lines.push('• '+x.plan.plan_name+' ('+x.plan.discount_percent+'٪)'+
        (x.money?' | تخفیف: '+fmt(x.money.savingIRR)+' ریال':' | مبلغ قابل محاسبه نیست'));
    if (evaluation.winner) {
      lines.push('✅ بهترین طرح برای اقلام مشمول: '+evaluation.winner.plan.plan_name+
        ' | جمع اقلام مشمول طرح: '+fmt(evaluation.winner.money.totalIRR)+' ریال');
      for (const x of evaluation.winner.money.itemPrices) {
        const p = products.get(x.product_id);
        lines.push('↳ '+p.product_name+': قیمت پس از کسر تخفیف از پایه باکس، هر بسته '+fmt(x.finalPricePerPackIRR)+
          ' ریال | جمع '+fmt(x.qty)+' بسته: '+fmt(x.lineTotalIRR)+' ریال');
      }
      lines.push('مجموع فوق فقط اقلام مشمول همین طرح را دربرمی‌گیرد، نه اقلام دیگر سبد.');
    } else lines.push('⚠️ اعلام قیمت نهایی به تأیید مبنای قیمت، مجوز انتشار و قواعد مالیات/گردکردن نیاز دارد.');
  }else lines.push('هنوز طرح فعالی برای این ترکیب دقیق واجد شرایط نیست.');
  lines.push('حذف کل سبد: /clear');
  lines.push('پیشنهاد ارتقا: /suggest');
  lines.push('⚠️ هیچ تخفیفی روی یک بسته دوبار اعمال نمی‌شود؛ تقسیم بخشی از سبد بین طرح‌ها فعال نیست.');
  return reply(lines.join('\n'));
}
function upsellText(cart,data){
  if(!cart.length)return reply('ابتدا محصول به سبد اضافه کنید تا پیشنهادهای دقیق بررسی شوند.');
  const list=suggestions(cart,data);
  if(!list.length)return reply('برای این ترکیب، پیشنهاد ارتقای قابل‌تأیید دیگری یافت نشد.');
  const lines=['💡 پیشنهاد افزایش تخفیف (مستلزم خرید بسته‌های اضافه):'];
  for(const x of list) {
    lines.push('• '+x.plan.plan_name+' — '+fmt(x.plan.discount_percent)+'٪');
    lines.push('اضافه کنید: '+x.adds.map(a=>fmt(a.packs)+' بسته '+(groupNames[a.group_id]||a.group_id)).join(' + '));
  }
  lines.push('⚠️ درصد بیشتر الزاماً به معنی فاکتور ارزان‌تر نیست. قیمت نهایی بدون قیمت پایه و مالیات/گردکردن تأییدشده اعلام نمی‌شود.');
  return reply(lines.join('\n'));
}
export async function botReply(update,env,requestFetch=fetch){
  if(!isDb(env))return reply('سبد خرید هنوز به پایگاه داده متصل نشده است؛ امکان ثبت خرید وجود ندارد.');
  let data;
  try {data=await sheetCatalog(env,requestFetch);}
  catch {return reply('اتصال امن به فهرست تأییدشده محصولات و طرح‌ها برقرار نیست. هیچ اطلاعات تأییدنشده‌ای نمایش داده نمی‌شود.');}
  const cb=update?.callback_query;
  const message=cb?.message||update?.message;
  const user=cb?.from||message?.from;
  if(!message || message.chat?.type!=='private' || !Number.isSafeInteger(user?.id) ||
    !Number.isSafeInteger(message.chat?.id)) return null;
  const chatId=message.chat.id;
  const content=cb?.data || (typeof message.text==='string'?message.text.trim():'');
  if(content==='/start'||content==='/help'||content==='ℹ️ راهنما'){
    return reply('به دستیار فروش خوشگوار خوش آمدید.\nمحصولات و طرح‌های فقط پس از تأیید انتشار و اعتبار قابل نمایش‌اند.\nبرای افزودن محصول: /add P001 1\nبرای کم‌کردن: /remove P001 1\nبرای سبد: /cart\nبرای قیمت مصرف‌کننده: /prices\nبرای پیشنهاد بیشتر: /suggest\nبرای مشاوره مستقیم: /consult\nعکس‌ها فعلاً غیرفعال‌اند.');
  }
  const productPage=content.match(/^\/products(?:\s+(\d{1,2}))?$/i);
  const pricesPage=content.match(/^\/prices(?:\s+(\d{1,2}))?$/i);
  if(content==='📦 محصولات'||productPage)return productList(data,Number(productPage?.[1]||1));
  if(content==='💰 قیمت‌ها'||pricesPage)return priceList(data,Number(pricesPage?.[1]||1));
  const priceId=content.match(/^\/(?:price|product)\s+([A-Za-z0-9_-]{1,40})$/i);
  if (priceId) {
    const p=data.products.find(p=>p.product_id===priceId[1]);
    return p ? reply('📦 '+p.product_name+'\n'+
      (p.units_per_pack?'تعداد در باکس: '+fmt(p.units_per_pack)+'\n':'')+
      (p.shelf_life_months?'مدت ماندگاری ثبت‌شده: '+fmt(p.shelf_life_months)+' ماه\n':'')+
      (p.variants?.length?'طعم‌ها: '+p.variants.join('، ')+'\n':'')+
      consumerText(p)+'\n'+boxBaseText(p)+
      '\nمحاسبه شرایط طرح در سبد: /add '+p.product_id+' 1')
      : reply('محصول عمومی تأییدشده با این شناسه پیدا نشد.');
  }
  if(content==='🏷 طرح‌های عمومی'||content==='/plans')return planList(data);
  const selectedPlan=content.match(/^\/plan\s+(D\d{3})$/i);
  if(selectedPlan){
    const p=data.plans.find(x=>x.plan_id===selectedPlan[1].toUpperCase());
    return p?reply('🏷 '+p.plan_name+' — '+fmt(p.discount_percent)+'٪\n'+p.conditions+
      '\nاجرای تخفیف به تطبیق گروه و تعداد بسته‌ها وابسته است.')
      :reply('این طرح برای نمایش عمومی تأیید یا معتبر نشده است.');
  }
  if(content==='🛒 سبد خرید'||content==='/cart'){
    const cart=await cartFor(env.CART_DB,chatId);return cartText(cart,data,env);
  }
  if(content==='💡 پیشنهاد تخفیف بیشتر'||content==='/suggest'){
    return upsellText(await cartFor(env.CART_DB,chatId),data);
  }
  if(content==='/clear'){
    await env.CART_DB.prepare('DELETE FROM cart_items WHERE chat_id=?').bind(String(chatId)).run();
    return reply('سبد خرید شما خالی شد.');
  }
  if(content==='/admin')return reply('دسترسی مدیریت از این مسیر فعال نیست.');
  const add=arg(content,'add'),remove=arg(content,'remove');
  if(add||remove){
    const command=add||remove;
    if(command.qty<1||command.qty>maxQty)return reply('تعداد باید بین ۱ تا ۱۰٬۰۰۰ بسته باشد.');
    if(!data.products.some(p=>p.product_id===command.id&&approvedProduct(p)))
      return reply('محصول عمومی تأییدشده با این شناسه پیدا نشد.');
    const changed=await changeCart(env.CART_DB,chatId,command.id,add?command.qty:-command.qty);
    if(!changed)return reply('تعداد از سقف مجاز سبد بیشتر است.');
    return cartText(await cartFor(env.CART_DB,chatId),data,env);
  }
  return reply('از دکمه‌ها استفاده کنید؛ افزودن نمونه: /add P001 1');
}
