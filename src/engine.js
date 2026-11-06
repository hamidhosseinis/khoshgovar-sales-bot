// The evaluator is pure. No unpublished spreadsheet row is ever eligible.
export function allowed(value) { return String(value ?? '').trim().toUpperCase() === 'TRUE'; }
export function approvedProduct(p) {
  return allowed(p.approved_for_public) && p.publish_status === 'PUBLISHED' &&
    typeof p.product_id === 'string' && /^[A-Za-z0-9_-]{1,40}$/.test(p.product_id);
}
export function approvedPlan(p, today = new Date().toISOString().slice(0, 10)) {
  return allowed(p.approved_for_public) && allowed(p.is_active) &&
    p.review_status === 'APPROVED' &&
    /^\d{4}-\d{2}-\d{2}$/.test(p.valid_from || '') &&
    /^\d{4}-\d{2}-\d{2}$/.test(p.valid_to || '') &&
    p.valid_from <= today && today <= p.valid_to &&
    Number.isInteger(Number(p.discount_percent)) &&
    Number(p.discount_percent) >= 0 && Number(p.discount_percent) <= 100;
}
export function verified(p) { return allowed(p.group_verified); }
export function inGroup(product, group) {
  if (!verified(product)) return false;
  const id = product.group_id;
  const category = String(product.category_name || '');
  const soda = id === 'ORIGINAL_SODA' || id === 'CANADA_SODA' ||
    id === 'SODA_ALL' || (category.includes('نوشابه') && id !== 'NON_SODA');
  if (group === 'SODA_ALL') return soda;
  if (group === 'NON_SODA') return !soda;
  if (group === 'NON_SODA_NON_DASANI') return !soda && id !== 'DASANI_WATER';
  return id === group;
}
export function publicData(rows, today) {
  const products = (rows.Products || []).filter(approvedProduct).map(p => ({
    product_id: p.product_id, product_name: p.product_name, flavor: p.flavor,
    units_per_pack: p.units_per_pack, shelf_life_months: p.shelf_life_months,
    base_price_irr: p.base_price_irr, base_price_basis: p.base_price_basis,
    category_name: p.category_name, group_id: p.group_id, group_verified: p.group_verified,
  }));
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
  const discount = BigInt(eligible.plan.discount_percent);
  for (const item of eligible.items) {
    const p = item.product;
    if (p.base_price_basis !== 'PACK_WITH_TAX' ||
        !/^[1-9]\d*$/.test(String(p.base_price_irr)) ||
        BigInt(p.base_price_irr) > BigInt(Number.MAX_SAFE_INTEGER)) return null;
    const base = BigInt(p.base_price_irr);
    const discounted = (base * (100n - discount) + 50n) / 100n;
    total += discounted * BigInt(item.qty);
    saving += (base - discounted) * BigInt(item.qty);
  }
  if (total > BigInt(Number.MAX_SAFE_INTEGER) || saving > BigInt(Number.MAX_SAFE_INTEGER)) return null;
  return {totalIRR:String(total), savingIRR:String(saving)};
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
