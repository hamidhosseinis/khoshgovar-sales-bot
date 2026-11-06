/**
 * Whitelisted public data, copied from an explicitly authorized user submission.
 * Never import data/drafts or internal company files into public bot code.
 * Monetary figures are verbatim; their per-bottle/per-case basis is UNKNOWN.
 */
export const PUBLIC_PRODUCT = Object.freeze({
  productId: 'nostalgic-soda',
  name: 'نوشابه نوستالژیک',
  flavors: Object.freeze(['کوکاکولا', 'فانتا پرتقالی']),
  unitsPerCase: 12,
  shelfLifeMonths: 6,
  imageViewUrl: 'https://drive.google.com/file/d/1R597QVAJoAsNfrNj_-Bm1JoGYvBhSKEV/view',
  consumerPriceIRR: 800000,
  priceUnitBasis: null,
  automaticPricingAllowed: false,
  offers: Object.freeze([
    Object.freeze({
      name: 'طرح ۱', discountLabel: 'خالص ۱۰٪ تخفیف',
      finalBuyerPriceIncludesTaxIRR: 640000,
      condition: 'شرط تعداد سفارش اعلام نشده است.',
    }),
    Object.freeze({
      name: 'طرح ۲', discountLabel: '۱۳٪ تخفیف',
      finalBuyerPriceIncludesTaxIRR: 618900,
      condition: '۴ بسته نوشابه جور به همراه ۱ بسته محصول دیگر (به‌جز نوشابه)',
    }),
    Object.freeze({
      name: 'طرح ۳', discountLabel: '۱۵٪ تخفیف',
      finalBuyerPriceIncludesTaxIRR: 605000,
      condition: '۱۰ بسته نوشابه جور به همراه ۳ بسته محصول دیگر (به‌جز نوشابه و آب)',
    }),
  ]),
  publication: Object.freeze({
    approvedForPublicDisplay: true,
    approvalSource: 'user_explicit_chat_2026-11-06',
    geographicScope: null,
    validFrom: null,
    validUntil: null,
  }),
});
