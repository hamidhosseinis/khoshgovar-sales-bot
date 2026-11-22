import test from 'node:test';
import assert from 'node:assert/strict';
import { approvedPlanAnnouncements, planAnnouncementList, planAnnouncementDetail } from '../src/plan-announcements.js';
import { publicData } from '../src/engine.js';

const today = '2026-11-22';
const row = (id, discount, conditions, extra = {}) => ({
  plan_id: id, discount_percent: String(discount), conditions,
  is_active: 'TRUE', approved_for_public: 'TRUE', review_status: 'APPROVED',
  valid_from: '2026-11-22', valid_to: '', sort_order: '1', ...extra,
});
test('plan announcements display only current, published, unique valid rows', () => {
  const accepted = row('PA015', 15, 'بالای ۱۰ بسته نوشابه');
  const approved = approvedPlanAnnouncements([
    row('PA033', 33, 'تنوع بالای ۲ بسته', {sort_order:'4'}),
    accepted,
    row('PA017', 17, 'تنوع', { approved_for_public: 'FALSE' }),
    row('PA018', 18, 'تنوع', { is_active: 'FALSE' }),
    row('PA019', 19, 'تنوع', { review_status: 'DRAFT' }),
    row('PA020', 20, 'تنوع', { valid_from: '2026-12-01' }),
    row('PA021', 21, 'تنوع', { valid_to: '2026-11-21' }),
    row('PA022', 22, 'تنوع', { conditions: ' ' }),
    row('PA023', 23, 'تنوع', { valid_to: 'not-a-date' }),
    row('PA030', 30, 'first'),
    row('PA030', 30, 'conflict'),
    row('BAD_ID', 40, 'private'),
  ], today);
  assert.deepEqual(approved.map(p => p.plan_id), ['PA015', 'PA033']);
  assert.deepEqual(approved[0], {
    plan_id:'PA015', discount_percent:15, conditions:'بالای ۱۰ بسته نوشابه',
  });
  assert.deepEqual(approvedPlanAnnouncements([accepted], '2026-11-21'), []);
  assert.deepEqual(approvedPlanAnnouncements([accepted], 'invalid'), []);
});

test('two-column percent-only buttons show details, never compute a price', () => {
  const plans = approvedPlanAnnouncements([
    row('PA015', 15, 'بالای ۱۰ بسته نوشابه', {sort_order:'1'}),
    row('PA017', 17, 'بالای ۱۰ بسته + ۲ تنوع بجز آب', {sort_order:'2'}),
    row('PA020', 20, 'بالای ۲۰ بسته + ۳ تنوع بجز آب', {sort_order:'3'}),
    row('PA033', 33, 'تنوع بالای ۲ بسته', {sort_order:'4'}),
  ], today);
  const catalog = { planAnnouncements: plans };
  const list = planAnnouncementList(catalog);
  assert.deepEqual(list.reply_markup.inline_keyboard.slice(0,2).map(row=>row.map(b=>b.text)),
    [['۱۵٪ تخفیف','۱۷٪ تخفیف'],['۲۰٪ تخفیف','۳۳٪ تخفیف']]);
  const detail = planAnnouncementDetail(catalog, 'PA033');
  assert.match(detail.text, /۳۳٪ تخفیف/);
  assert.match(detail.text, /تنوع بالای ۲ بسته/);
  assert.doesNotMatch(detail.text, /تومان|قیمت|محاسبه/);
  assert.ok(detail.reply_markup.inline_keyboard.flat()
    .some(x=>x.callback_data==='plan-announcements'));
  assert.match(planAnnouncementDetail(catalog,'PA999').text,/در دسترس نیست/);
  assert.match(planAnnouncementList({}).text,/وجود ندارد/);
});

test('information-only plan notices do not enter price or eligibility machinery', () => {
  const rows = {
    Products:[],
    Plan_Announcements:[row('PA015',15,'بالای ۱۰ بسته نوشابه')],
  };
  const data = publicData(rows,today,{ownerOnly:true});
  assert.deepEqual(data.plans,[]);
  assert.deepEqual(data.priceRates,[]);
  assert.deepEqual(approvedPlanAnnouncements(rows.Plan_Announcements,today).map(x=>x.plan_id),['PA015']);
});
