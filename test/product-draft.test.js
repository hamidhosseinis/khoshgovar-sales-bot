import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { publicReply } from '../src/messages.js';

const draft = JSON.parse(readFileSync(new URL('../data/drafts/nostalgic-soda.json', import.meta.url), 'utf8'));
const productMessage = { text: '📦 محصولات', chat: { type: 'private', id: 123 }, from: { id: 123 } };

test('nostalgic soda is stored as an unpublished, unapproved draft', () => {
  assert.equal(draft.product_id, 'nostalgic-soda');
  assert.equal(draft.governance.status, 'draft');
  assert.equal(draft.governance.published, false);
  assert.equal(draft.governance.authorized_for_publication, false);
  assert.equal(draft.governance.price_formula_approved, false);
  assert.equal(draft.image.usage_rights_verified, false);
});

test('case and prices match the submitted values without inventing a unit basis', () => {
  assert.deepEqual(draft.variants.map((variant) => variant.title_fa), ['کوکاکولا', 'فانتا پرتقالی']);
  assert.equal(draft.units_per_case, 12);
  assert.equal(draft.shelf_life.value, 6);
  assert.equal(draft.prices.basis, 'unconfirmed_per_unit_or_case');
  assert.equal(draft.prices.consumer_price, 800000);
  assert.deepEqual(draft.prices.offers.map((offer) => [offer.discount_percent, offer.final_buyer_price]), [
    [10, 640000], [13, 618900], [15, 605000],
  ]);
});

test('mixed-case conditions are captured without guessing eligibility rules', () => {
  assert.deepEqual(draft.prices.offers[1].requirements, {
    soda_cases: 4, soda_mix_allowed: true, other_cases: 1, other_excludes: ['نوشابه'],
  });
  assert.deepEqual(draft.prices.offers[2].requirements, {
    soda_cases: 10, soda_mix_allowed: true, other_cases: 3, other_excludes: ['نوشابه', 'آب'],
  });
});

test('draft product and commercial prices never appear in public catalog response', () => {
  const response = JSON.stringify(publicReply(productMessage, {}));
  assert.doesNotMatch(response, /نوشابه نوستالژیک|618900|605000|640000|800000/);
});
