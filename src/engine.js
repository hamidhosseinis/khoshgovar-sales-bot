// The evaluator is pure. No unpublished spreadsheet row is ever eligible.
export function allowed(value) { return String(value ?? '').trim().toUpperCase() === 'TRUE'; }
function isoDate(value) {
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const date = new Date(value + 'T00:00:00.000Z');
  return !Number.isNaN(date.getTime()) && date.toISOString().slice(0, 10) === value;
}
// Retail/consumer prices never come from Product_Price_Import automatically.
// They require row-level publication approval, an explicit unit and valid dates.
export function publicConsumerPrice(p, today) {
  if (!allowed(p.consumer_price_approved_for_public) ||
      !isoDate(p.consumer_price_valid_from) ||
      (p.consumer_price_valid_to && !isoDate(p.consumer_price_valid_to)) ||
      p.consumer_price_valid_from > today ||
      (p.consumer_price_valid_to && p.consumer_price_valid_to < today) ||
      !['UNIT', 'PACK'].includes(p.consumer_price_basis) ||
      !/^[1-9]\d*$/.test(String(p.consumer_price_irr ?? ''))) return null;
  const amount = BigInt(p.consumer_price_irr);
  return amount <= BigInt(Number.MAX_SAFE_INTEGER)
    ? { amountIRR: String(amount), basis: p.consumer_price_basis }
    : null;
}
// base_price_per_box is authoritative. The per-unit figure is a consistency
// check only: multiplying a rounded unit value must never change the box base.
// Spreadsheet floating-point formula outputs may differ in their final digits.
export function verifiedBoxBase(p) {
  const raw = String(p.base_price_per_box ?? '').trim();
  const unitRaw = String(p.box_unit_base_price ?? '').trim();
  const qtyRaw = String(p.units_per_pack ?? '').trim();
  if (!/^[1-9]\d*$/.test(raw) || !/^[1-9]\d*$/.test(qtyRaw)) return null;
  const match = unitRaw.match(/^(\d+)(?:\.(\d{1,15}))?$/);
  if (!match) return null;
  const box = BigInt(raw), count = BigInt(qtyRaw);
  if (box > BigInt(Number.MAX_SAFE_INTEGER) || count > 10000n) return null;
  const decimals = match[2] ?? '';
  const scale = 10n ** BigInt(decimals.length);
  const perUnit = BigInt(match[1]) * scale + BigInt(decimals || '0');
  if (perUnit <= 0n) return null;
  const diff = box * scale - perUnit * count;
  const absDiff = diff < 0n ? -diff : diff;
  // At integer precision allow up to half an IRR per unit. For formula
  // decimals allow half the last meaningful (up to 8th) decimal position.
  const roundingUnit = decimals.length > 8 ? 10n ** BigInt(decimals.length - 8) : 1n;
  if (absDiff * 2n > count * roundingUnit) return null;
  return raw;
}
// A public box-base quote is only the input stored in Sheets. It is NOT an
// approved tax-inclusive final price or a promise of a discount calculation.
export function publicBoxBase(p) {
  if (!allowed(p.base_box_price_approved_for_public)) return null;
  const amount = verifiedBoxBase(p);
  return amount ? { amountIRR: amount, unitRawIRR: String(p.box_unit_base_price).trim(),
    basis: 'PACK', taxVerified: false } : null;
}
function approvedPackBase(p) {
  if (!allowed(p.final_price_approved_for_public) ||
      p.base_price_basis !== 'PACK_WITH_TAX') return null;
  const suppliedBox = String(p.base_price_per_box ?? '').trim();
  if (suppliedBox) return verifiedBoxBase(p);
  // Backwards compatible with explicitly verified legacy PACK_WITH_TAX data.
  const legacy = String(p.base_price_irr ?? '').trim();
  return /^[1-9]\d*$/.test(legacy) && BigInt(legacy) <= BigInt(Number.MAX_SAFE_INTEGER)
    ? legacy : null;
}
export function approvedProduct(p) {
  return allowed(p.approved_for_public) && p.publish_status === 'PUBLISHED' &&
    typeof p.product_id === 'string' && /^[A-Za-z0-9_-]{1,40}$/.test(p.product_id) &&
    typeof p.product_name === 'string' && p.product_name.trim().length > 0 &&
    p.product_name.trim().length <= 160;
}
export function approvedPlan(p, today = new Date().toISOString().slice(0, 10)) {
  return allowed(p.approved_for_public) && allowed(p.is_active) &&
    p.review_status === 'APPROVED' &&
    isoDate(p.valid_from) &&
    (!p.valid_to || isoDate(p.valid_to)) &&
    p.valid_from <= today && (!p.valid_to || today <= p.valid_to) &&
    Number.isInteger(Number(p.discount_percent)) &&
    Number(p.discount_percent) >= 0 && Number(p.discount_percent) <= 100;
}
export function verified(p) { return allowed(p.group_verified); }
export function inGroup(product, group) {
  if (!verified(product)) return false;
  const id = String(product.group_id || '');
  // Secondary recognition is exclusion-only for complement groups: a wrong
  // group_id must not turn an original/Canada soda or water/milk into "variety".
  const normalize = value => String(value || '').replace(/‌/g, ' ')
    .replace(/\s+/g, ' ').trim();
  const category = normalize(product.category_name);
  const name = normalize(product.product_name);
  const originalNamed = category.includes('نوشابه اورجینال') ||
    name.includes('نوشابه اورجینال');
  const canadaNamed = category.includes('نوشابه کانادا') ||
    name.includes('نوشابه کانادا');
  // Conflicting soda-family labels are never grounds for a customer quote.
  if ((id === 'ORIGINAL_SODA' && canadaNamed) ||
      (id === 'CANADA_SODA' && originalNamed)) return false;
  const original = id === 'ORIGINAL_SODA' || originalNamed;
  const canada = id === 'CANADA_SODA' || canadaNamed;
  const soda = original || canada || id === 'SODA_ALL' ||
    category.includes('نوشابه') || /^نوشابه(?:\s|$)/.test(name);
  // "آبمیوه" is not plain water; require a word boundary after "آب".
  const water = id === 'DASANI_WATER' || id === 'WATER_ALL' ||
    category === 'آب' || /^آب(?:\s|$)/.test(name);
  const milk = id === 'MILK' || category === 'شیر' || /^شیر(?:\s|$)/.test(name);
  const doogh = id === 'DOOGH' || category === 'دوغ' || /^دوغ(?:\s|$)/.test(name);
  if (group === 'SODA_ALL') return soda;
  if (group === 'WATER_ALL') return water;
  if (group === 'NON_SODA') return !soda;
  if (group === 'NON_SODA_NON_DASANI') return !soda && id !== 'DASANI_WATER' &&
    !/^آب دسانی(?:\s|$)/.test(name);
  if (group === 'DOOGH_MILK') return doogh || milk;
  if (group === 'DIVERSITY_EXCL_CORE') return !original && !canada && !water && !milk;
  if (group === 'ORIGINAL_CANADA_COMBINED') return original || canada;
  if (group === 'VARIETY_NON_WATER_NON_MILK') return !water && !milk;
  return id === group;
}
// The current canonical Products tab includes a JSON array of variants per row.
// A product-level publication flag does not approve any variant: each entry
// requires its own explicit public approval. Never fall back to raw flavor text.
function approvedInlineVariants(product) {
  const raw = product.variants_json;
  if (typeof raw !== 'string' || raw.length > 50000) return [];
  let entries;
  try { entries = JSON.parse(raw); } catch { return []; }
  if (!Array.isArray(entries) || entries.length > 100) return [];
  const names = [];
  for (const v of entries) {
    if (!v || typeof v !== 'object' || Array.isArray(v) ||
        !allowed(v.approved_for_public) || v.product_id !== product.product_id ||
        (v.product_name && v.product_name !== product.product_name) ||
        typeof v.variant_name !== 'string') continue;
    const name = v.variant_name.trim();
    if (name && name.length <= 100 && !names.includes(name)) names.push(name);
    if (names.length >= 30) break;
  }
  return names;
}
export function publicData(rows, today) {
  const variants = new Map();
  for (const v of rows.Product_Variants || []) {
    const pid = String(v.product_id || '');
    const name = String(v.variant_name || '').trim();
    if (!allowed(v.approved_for_public) || !/^[A-Za-z0-9_-]{1,40}$/.test(pid) ||
        !name || name.length > 100) continue;
    const list = variants.get(pid) || [];
    if (!list.includes(name) && list.length < 30) list.push(name);
    variants.set(pid, list);
  }
  const products = (rows.Products || []).filter(approvedProduct).map(p => {
    const approvedBase = approvedPackBase(p);
    return {
      product_id: p.product_id, product_name: p.product_name.trim(),
      units_per_pack: p.units_per_pack, shelf_life_months: p.shelf_life_months,
      // Never carry an unpublished input price into the public pricing evaluator.
      base_price_irr: approvedBase,
      base_price_basis: approvedBase ? 'PACK_WITH_TAX' : null,
      final_price_approved_for_public: Boolean(approvedBase),
      consumer_price: publicConsumerPrice(p, today),
      box_base_price: publicBoxBase(p),
      variants: [...new Set([...(variants.get(p.product_id) || []),
        ...approvedInlineVariants(p)])].slice(0, 30),
      category_name: p.category_name, group_id: p.group_id, group_verified: p.group_verified,
    };
  });
  const plans = (rows.Discount_Plans || []).filter(p => approvedPlan(p, today)).map(p => ({
    plan_id: p.plan_id, plan_name: p.plan_name, discount_percent: p.discount_percent,
    conditions: p.conditions, quantity_rule: p.quantity_rule, max_multiplier: p.max_multiplier,
  }));
  const ids = new Set(plans.map(p => p.plan_id));
  const productIds = new Set(products.map(p => p.product_id));
  const links = (rows.Product_Plans || []).filter(p => ids.has(p.plan_id) &&
    productIds.has(p.product_id) && allowed(p.is_active) && allowed(p.approved_for_public));
  return {
    products, plans, links,
    requirements: (rows.Plan_Requirements || []).filter(r => ids.has(r.plan_id)).map(r => ({
      plan_id:r.plan_id, group_id:r.group_id, packs_per_step:r.packs_per_step,
      min_packs:r.min_packs, max_packs:r.max_packs, quantity_rule:r.quantity_rule,
    })),
    targets: (rows.Plan_Discount_Targets || []).filter(r => ids.has(r.plan_id)).map(r => ({
      plan_id:r.plan_id, group_id:r.group_id,
    })),
    // Never include internal columns, notes, unpublished upsell rules or policy drafts.
  };
}
export function quantities(cart, data) {
  const products = new Map(data.products.map(p => [p.product_id, p]));
  return (cart || []).filter(x => Number.isInteger(x.qty) && x.qty > 0 &&
    products.has(x.product_id)).map(x => ({...x, product: products.get(x.product_id)}));
}
function groupQty(entries, group) {
  return entries.reduce((total, x) => total + (inGroup(x.product, group) ? x.qty : 0), 0);
}
function related(entries, plan, data) {
  const targets = data.targets.filter(t => t.plan_id === plan.plan_id);
  const links = new Set(data.links.filter(l => l.plan_id === plan.plan_id).map(l => l.product_id));
  return entries.filter(x => links.has(x.product_id) &&
    targets.some(t => inGroup(x.product, t.group_id)));
}
export function qualifies(entries, plan, data) {
  const requirements = data.requirements.filter(r => r.plan_id === plan.plan_id);
  const eligibleEntries = related(entries, plan, data);
  if (!requirements.length || !eligibleEntries.length) return false;
  // D012 permits one complementary pack from a group that overlaps ORIGINAL_SODA.
  // Check disjoint physical quantities, not independent counts of overlapping groups.
  // This protects against falsely treating the same three original packs as 3 + 1.
  if (plan.plan_id === 'D012') {
    const primary = requirements.find(r => r.group_id === 'ORIGINAL_SODA');
    const extra = requirements.find(r => r.group_id === 'VARIETY_NON_WATER_NON_MILK');
    if (requirements.length !== 2 || !primary || !extra ||
        primary.quantity_rule !== 'EXACT_MULTIPLE' ||
        extra.quantity_rule !== 'EXACT_MULTIPLE' ||
        Number(primary.packs_per_step) !== 3 ||
        Number(extra.packs_per_step) !== 1 || Number(plan.max_multiplier) !== 1) return false;
    const total = eligibleEntries.reduce((sum, x) => sum + x.qty, 0);
    // Four distinct physical packs; at least three must be original soda.
    // All four must qualify as non-water/non-milk (so one can be assigned to variety).
    return total === 4 &&
      groupQty(eligibleEntries, 'ORIGINAL_SODA') >= 3 &&
      groupQty(eligibleEntries, 'VARIETY_NON_WATER_NON_MILK') === 4;
  }
  let multiplier = null;
  for (const req of requirements) {
    const actual = groupQty(eligibleEntries, req.group_id);
    if (req.quantity_rule === 'EXACT_MULTIPLE') {
      const step = Number(req.packs_per_step);
      if (!Number.isSafeInteger(step) || step < 1 || !actual || actual % step !== 0) return false;
      const n = actual / step;
      if (!Number.isSafeInteger(n) || n < 1 || (plan.max_multiplier && n > Number(plan.max_multiplier))) return false;
      if (multiplier !== null && multiplier !== n) return false;
      multiplier = n;
    } else if (req.quantity_rule === 'MINIMUM') {
      if (!Number.isSafeInteger(Number(req.min_packs)) || actual < Number(req.min_packs)) return false;
    } else if (req.quantity_rule === 'RANGE') {
      if (!Number.isSafeInteger(Number(req.min_packs)) ||
          !Number.isSafeInteger(Number(req.max_packs)) ||
          actual < Number(req.min_packs) || actual > Number(req.max_packs)) return false;
    } else return false;
  }
  return true;
}
export function eligiblePlans(cart, data) {
  const entries = quantities(cart, data);
  return data.plans.filter(p => qualifies(entries, p, data))
    .map(p => ({ plan:p, items:related(entries, p, data) }));
}
// Monetary math is strictly opt-in and per-case only; unknown tax/basis NEVER inferred.
// A plan cannot be picked for "best savings" using percentages alone.
export function monetaryEvaluation(eligible, env) {
  if (env?.PRICE_POLICY_APPROVED !== 'true' || env?.ROUNDING_RULE !== 'HALF_UP_IRR') return null;
  let saving = 0n, total = 0n;
  const itemPrices = [];
  const discount = BigInt(eligible.plan.discount_percent);
  for (const item of eligible.items) {
    const p = item.product;
    if (p.final_price_approved_for_public !== true ||
        p.base_price_basis !== 'PACK_WITH_TAX' ||
        !/^[1-9]\d*$/.test(String(p.base_price_irr)) ||
        BigInt(p.base_price_irr) > BigInt(Number.MAX_SAFE_INTEGER)) return null;
    const base = BigInt(p.base_price_irr);
    // Approved HALF_UP_IRR rule: round per pack, then multiply by pack count.
    const discounted = (base * (100n - discount) + 50n) / 100n;
    const lineTotal = discounted * BigInt(item.qty);
    total += lineTotal;
    saving += (base - discounted) * BigInt(item.qty);
    itemPrices.push({
      product_id: p.product_id, qty: item.qty,
      finalPricePerPackIRR: String(discounted), lineTotalIRR: String(lineTotal),
    });
  }
  if (total > BigInt(Number.MAX_SAFE_INTEGER) || saving > BigInt(Number.MAX_SAFE_INTEGER)) return null;
  return {totalIRR:String(total), savingIRR:String(saving), itemPrices};
}
export function bestPlan(cart, data, env) {
  const list = eligiblePlans(cart, data).map(x => ({...x, money: monetaryEvaluation(x, env)}));
  if (!list.length) return {list, winner:null};
  if (list.some(x => !x.money)) return {list, winner:null};
  list.sort((a,b) => {
    const sa = BigInt(a.money.savingIRR), sb = BigInt(b.money.savingIRR);
    return sa === sb ? a.plan.plan_id.localeCompare(b.plan.plan_id) : (sa > sb ? -1 : 1);
  });
  return {list, winner:list[0]};
}
// Conservative: only offer adding packs. Do not allocate partial multipliers or stack plans.
export function suggestions(cart, data) {
  const entries = quantities(cart, data);
  const result = [];
  for (const plan of data.plans) {
    if (qualifies(entries, plan, data)) continue;
    const reqs = data.requirements.filter(r=>r.plan_id===plan.plan_id);
    if (!reqs.length) continue;
    const adds = [];
    const linkedEntries = related(entries,plan,data);
    const exact = reqs.filter(r=>r.quantity_rule==='EXACT_MULTIPLE');
    let n = 1;
    if (exact.length) {
      n = Math.max(1, ...exact.map(r=>Math.ceil(groupQty(linkedEntries,r.group_id) / Number(r.packs_per_step || 1))));
      if (plan.max_multiplier && n > Number(plan.max_multiplier)) continue;
    }
    let possible = true;
    for (const r of reqs) {
      const actual = groupQty(linkedEntries,r.group_id);
      let need = 0;
      if (r.quantity_rule === 'EXACT_MULTIPLE') need = Number(r.packs_per_step) * n - actual;
      else if (r.quantity_rule === 'MINIMUM' || r.quantity_rule === 'RANGE') {
        need = Math.max(0,Number(r.min_packs) - actual);
        if (r.quantity_rule === 'RANGE' && actual > Number(r.max_packs)) possible=false;
      } else possible=false;
      if (!Number.isSafeInteger(need) || need < 0) possible=false;
      if (need > 0) adds.push({group_id:r.group_id, packs:need});
    }
    if (!possible || !adds.length) continue;
    // Without a published, group-verified SKU in each missing group, do not
    // imply that an unavailable product can actually be purchased.
    if (adds.some(a => !data.products.some(p => inGroup(p,a.group_id) &&
      data.links.some(l => l.plan_id === plan.plan_id && l.product_id === p.product_id)))) continue;
    const simulated = entries.map(x=>({product_id:x.product_id,qty:x.qty}));
    for (const a of adds) {
      const p=data.products.find(p=>inGroup(p,a.group_id) &&
        data.links.some(l=>l.plan_id===plan.plan_id && l.product_id===p.product_id));
      const x=simulated.find(i=>i.product_id===p.product_id);
      if(x)x.qty+=a.packs;else simulated.push({product_id:p.product_id,qty:a.packs});
    }
    if (!qualifies(quantities(simulated,data),plan,data)) continue;
    result.push({plan, adds, totalAdded:adds.reduce((s,a)=>s+a.packs,0)});
  }
  return result.sort((a,b)=>Number(b.plan.discount_percent)-Number(a.plan.discount_percent)||
    a.totalAdded-b.totalAdded).slice(0,5);
}
