# Publication and pricing rules — initial design

Status: proposal for review, **not yet connected to the company price list**.

## Information categories

**Public / customer approved:** public product name, approved product photo, size, pack quantity, explicitly approved customer price, eligible publicly announced promotions, offer start/end date, terms and regional scope.

**Restricted / internal:** acquisition or procurement prices, margin, internal salesperson data, commercial agreements, private customer discounts, unpublished prices and promotions, internal sales targets, employee or retailer personal details, operational credentials.

**Unknown:** treat as restricted until permission to publish is documented.

## Product record

Suggested fields: product_id, sku, public_title, brand, volume, pack_type, units_per_case, approved_public_image_ref, public_description, published, source_id, updated_at.

Keep internal business fields in separately protected tables/views; never place internal columns in public JSON, exported assets or bot responses.

## Public offer record

Suggested fields: offer_id, eligible_product_ids, public_discount_type, public_discount_value, audience, region, min_quantity, starts_at, ends_at, published, approval_actor, approval_at, approved_source_id, updated_at.

An offer can be used by customers only while valid and explicitly published.

## Pricing engine requirements

- Define whether source prices are in IRR or toman and display units clearly.
- Obtain verified base price, tax basis, tax rate, discount sequence, case quantity, ceiling/rounding rule, and region from authorized data.
- Calculate from precise decimal/integer monetary values; do not use floating-point shortcuts for financial accuracy.
- Do not assume discount percentages stack or that tax is included in base price.
- Separate customer checkout price from confidential internal costing.
- Reject missing, stale, mismatched, expired or unapproved prices.
- Display an effective date and offer conditions.
- Test with validated real examples before any production price publication.

## Source governance

The existing Khoshgovar Sheets are possible *input sources*, not automatic permission to publish their contents. Owner must confirm source ownership, accuracy and authorization. Cloudflare/Supabase integration will be specified at a later stage.

This repository is an independent personal software project; no official company endorsement is implied.
