import { card, fmt } from './bot-ui.js';

// These are informational plan notices only: never feed them to the
// quantity evaluator, product quotes, owner-only rates or checkout.
const active = value => String(value ?? '').trim().toUpperCase() === 'TRUE';
const dateIsValid = value => {
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const d = new Date(value + 'T00:00:00.000Z');
  return !Number.isNaN(d.getTime()) && d.toISOString().slice(0, 10) === value;
};

export function approvedPlanAnnouncements(rows, today) {
  if (!dateIsValid(today)) return [];
  const candidates = (Array.isArray(rows) ? rows : []).filter(p =>
    /^PA[A-Za-z0-9_-]{2,30}$/.test(String(p?.plan_id ?? '')) &&
    active(p.is_active) && active(p.approved_for_public) &&
    p.review_status === 'APPROVED' &&
    dateIsValid(p.valid_from) && (!p.valid_to || dateIsValid(p.valid_to)) &&
    p.valid_from <= today && (!p.valid_to || today <= p.valid_to) &&
    /^\d{1,2}$/.test(String(p.discount_percent)) &&
    Number(p.discount_percent) >= 1 && Number(p.discount_percent) <= 99 &&
    /^[1-9]\d{0,2}$/.test(String(p.sort_order)) &&
    typeof p.conditions === 'string' &&
    p.conditions.trim().length > 0 && p.conditions.trim().length <= 500);
  // Duplicate IDs are ambiguous: display neither conflicting record.
  const counts = new Map();
  for (const p of candidates) counts.set(p.plan_id, (counts.get(p.plan_id) || 0) + 1);
  return candidates.filter(p => counts.get(p.plan_id) === 1)
    .sort((a, b) => Number(a.sort_order) - Number(b.sort_order) ||
      a.plan_id.localeCompare(b.plan_id))
    .map(p => ({
      plan_id: p.plan_id,
      discount_percent: Number(p.discount_percent),
      conditions: p.conditions.trim(),
    }));
}

const fa = value => String(value).replace(/[0-9]/g, d => '۰۱۲۳۴۵۶۷۸۹'[Number(d)]);
export function planAnnouncementList(data) {
  const plans = data.planAnnouncements || [];
  if (!plans.length) return card('📋 فعلاً طرح فروش تأییدشده‌ای برای نمایش وجود ندارد.');
  const buttons = plans.map(p => ({
    text: fmt(p.discount_percent) + '٪ تخفیف', callback_data: 'plan-announcement:' + p.plan_id,
  }));
  const rows = Array.from({ length: Math.ceil(buttons.length / 2) },
    (_, i) => buttons.slice(i * 2, i * 2 + 2));
  return card('📋 طرح‌های فروش\nدرصد تخفیف موردنظر را انتخاب کنید:', rows);
}
export function planAnnouncementDetail(data, planId) {
  const plan = (data.planAnnouncements || []).find(p => p.plan_id === planId);
  if (!plan) return card('این طرح برای نمایش در دسترس نیست.');
  return card('🏷 ' + fa(plan.discount_percent) + '٪ تخفیف\n\n' +
    '📋 شرایط طرح:\n' + plan.conditions, [
    [{ text: '🔙 لیست طرح‌ها', callback_data: 'plan-announcements' }],
  ]);
}
