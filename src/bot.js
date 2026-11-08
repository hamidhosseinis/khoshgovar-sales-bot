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
  if (!p.consumer_price) return 'قیمت مصرف‌کننده: هنوز تأیید و منتشر نشده';
  const unit = p.consumer_price.basis === 'PACK' ? 'هر بسته' : 'هر عدد';
  return 'قیمت مصرف‌کننده ' + unit + ': ' + fmt(p.consumer_price.amountIRR) + ' ریال';
}
function priceList(data) {
  if (!data.products.length) return reply('قیمت عمومی محصولی هنوز تأیید نشده است.');
  const out=['💰 قیمت‌های مصرف‌کننده دارای مجوز انتشار:'];
  for (const p of data.products.slice(0, 25))
    out.push('• ' + p.product_id + ' — ' + p.product_name + '\n' + consumerText(p));
  out.push('قیمت تمام‌شده هر بسته تنها برای ترکیب واجد شرایط در /cart و پس از تصویب سیاست محاسبه نمایش داده می‌شود.');
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
function productList(data) {
  if(!data.products.length)return reply('هنوز محصول تأییدشده‌ای در فهرست عمومی منتشر نشده است.');
  const lines=['📦 محصولات قابل نمایش عمومی (عکس‌ها فعلاً غیرفعال‌اند):'];
  for(const p of data.products.slice(0,25)){
    lines.push('• '+p.product_id+' — '+p.product_name+
      (p.flavor?' ('+p.flavor+')':'')+
      (p.units_per_pack?' | '+p.units_per_pack+' عدد در بسته':''));
    lines.push(consumerText(p));
    lines.push('افزودن یک بسته: /add '+p.product_id+' 1');
  }
  return reply(lines.join('\n'));
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
  if(content==='📦 محصولات'||content==='/products')return productList(data);
  if(content==='💰 قیمت‌ها'||content==='/prices')return priceList(data);
  const priceId=content.match(/^\/price\s+([A-Za-z0-9_-]{1,40})$/i);
  if (priceId) {
    const p=data.products.find(p=>p.product_id===priceId[1]);
    return p ? reply(p.product_name+'\n'+consumerText(p)+
      '\nبرای مشاهده قیمت تمام‌شده پس از اعمال طرح واجد شرایط، محصول را به /cart اضافه کنید: /add '+p.product_id+' 1')
      : reply('محصول عمومی تأییدشده با این شناسه پیدا نشد.');
  }
  if(content==='🏷 طرح‌های عمومی'||content==='/plans')return planList(data);
  const selectedPlan=content.match(/^\\/plan\\s+(D\\d{3})$/i);
  if(selectedPlan){
    const p=data.plans.find(x=>x.plan_id===selectedPlan[1].toUpperCase());
    return p?reply('🏷 '+p.plan_name+' — '+fmt(p.discount_percent)+'٪\\n'+p.conditions+
      '\\nاجرای تخفیف به تطبیق گروه و تعداد بسته‌ها وابسته است.')
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
