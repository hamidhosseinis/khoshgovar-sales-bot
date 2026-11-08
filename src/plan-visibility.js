import { inGroup } from './engine.js';

// Server-side scopes approved for the twelve currently published promotions.
// A bad Product_Plans link or widened Sheets target may never make a discount
// available for a different family. New plan IDs fail closed until reviewed.
const SCOPES = Object.freeze({
  D001: ['ORIGINAL_SODA'],
  D002: ['ORIGINAL_SODA', 'NON_SODA'],
  D003: ['ORIGINAL_SODA', 'NON_SODA_NON_DASANI'],
  D004: ['CANADA_SODA'],
  D005: ['CANADA_SODA', 'KHOSH_LEMONADE'],
  D006: ['DASANI_WATER'],
  D007: ['ENERGY_DRINK'],
  D008: ['DOOGH_MILK'],
  D009: ['DIVERSITY_EXCL_CORE'],
  D010: ['DIVERSITY_EXCL_CORE'],
  D011: ['ORIGINAL_CANADA_COMBINED'],
  D012: ['ORIGINAL_SODA', 'VARIETY_NON_WATER_NON_MILK'],
});

export function planAppliesToProduct(product, plan, data) {
  const approvedGroups = SCOPES[plan?.plan_id];
  if (!product || !approvedGroups || !Array.isArray(data?.links) ||
      !Array.isArray(data?.targets)) return false;
  // A public, active Product_Plans row and a published target group are BOTH
  // necessary. Checking plan percentage or a Persian keyword is not sufficient.
  if (!data.links.some(l => l.product_id === product.product_id &&
      l.plan_id === plan.plan_id)) return false;
  return data.targets.some(t => t.plan_id === plan.plan_id &&
    approvedGroups.includes(t.group_id) && inGroup(product, t.group_id));
}
