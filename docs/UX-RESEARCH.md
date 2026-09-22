# Bale Drop — UI/UX Research & Design Decisions

Research date: 2026-09-22. Sources: marketplace UX best-practice guides and
Pinduoduo group-buy teardowns (links inline).

---

## 1. What the research says

**Trust converts more than beauty.** In tested marketplaces, trust signals
above the fold on the listing page (verification status, ratings, transaction
counts) increase conversion more than any other single change. Search that
resolves in under 3 interactions is the primary revenue lever; image galleries
beat text for decision speed.
([marketplace best practices](https://www.lowcode.agency/blog/marketplace-ui-ux-design-best-practices-full-guide))

**Mobile is the market.** 70%+ of ecommerce traffic is mobile, but mobile
conversion lags (~2.9%) — the gap is closed with mobile-first UX: speed ≤3s,
streamlined checkout, trust badges at payment, visible reviews.
([mobile 2026 guide](https://websitespeedy.com/blog/mobile-ecommerce-best-practices/),
[homepage guide](https://ecomhint.com/guides/homepage-optimization))

**Reviews are the highest-ROI trust element.** Displaying reviews can lift
conversion up to 270%. Star ratings belong next to titles; guarantees belong
next to the pay button.
([homepage guide](https://ecomhint.com/guides/homepage-optimization))

**Group-buy (Pinduoduo) mechanics that work:** team-purchase vs solo-buy price
anchoring, countdown urgency, live slot/progress visibility, invite-friends
share loops, non-linear socially-triggered discovery, and instant
deal notifications driving session frequency.
([how Pinduoduo works](https://miracuves.com/blog/what-is-pinduoduo-and-how-does-it-work/),
[UI teardown](https://uisources.com/china/pinduoduo))

---

## 2. Bale Drop design principles (derived)

1. **Trust above the fold, always.** Every listing shows vendor verification +
   grade + rating before the price. Every pay button sits next to an escrow note.
2. **Mobile-first, thumb-zone commerce.** Bottom nav, sticky buy bar, 44px+
   targets, one primary CTA per screen. Desktop is an enhancement, not the design.
3. **Urgency must be real.** Countdowns and "slots left" reflect live DB state
   (Supabase Realtime). Never fake scarcity — trust is the brand.
4. **Price anchoring everywhere.** Per-slot vs full-bale, sale vs old price,
   subsidized delivery struck through. Buyers decide by comparison.
5. **Grade is a language.** A/B/C badges are color-coded identically across
   cards, filters, detail pages and admin — learned once, read at a glance.
6. **Zero dead ends.** Every card links somewhere real; every empty/error state
   offers the next action. Prototype rule: no `#` links in shipped UI.
7. **Fast on ₦30k Androids.** System fonts, CSS/SVG art placeholders, no
   heavy carousels, images via Supabase Storage with transforms in prod.

---

## 3. Screen-by-screen decisions

| Screen | Key decisions |
|---|---|
| Homepage | Value prop + live "filling fast" split above fold → TrustStrip → splits → categories → arrivals → vendors → escrow explainer (objection handling last) |
| Listing detail | Gallery dominates; vendor card + grade + rating before price; sticky mobile buy bar; BaleWidget = countdown boxes + progress + slot chips + 2-step claim→pay; auto-refund guarantee inline |
| Bale Split cards | LIVE pulse badge, countdown chip, progress bar (red ≤2 left), per-slot price hero with total anchor, "Claim slot" CTA |
| Checkout | Single page (cart → address → delivery → pay); delivery subsidy shown as green line item; Paystack method pills (card/transfer/USSD); escrow note inside payment card |
| Orders | Visual 5-step timeline, tracking chip, big Confirm-delivery vs Open-dispute choice (releasing escrow is explicit) |
| Vendor onboarding | 3-step wizard with progress; "what happens next" rail kills drop-off anxiety; plan cards show fee + commission together |
| Admin | Queue tabs with counts; every money action labeled with its Edge Function + audit implication |

---

## 4. Component mapping (shadcn)

`Button` (7 variants incl. `accent` for splits) · `Badge` (verified/inspected/
live/gradeA-C) · `Card` · `Input` · `Progress` (a11y-complete) · `Avatar` +
`AvatarStack` · `Separator` · `Stars`. All themed by CSS variables in
`app/globals.css`. See `/design` route for the living system.

## 5. Budgets & validation plan

- **Perf:** LCP < 2.5s on 4G Android, zero layout shift on cards (fixed aspect ratios).
- **A11y:** contrast AA, visible focus rings, `role=progressbar/timer/radio`, 44px targets.
- **Metrics:** split-claim rate, claim→pay conversion, checkout completion, dispute rate, vendor approval turnaround.
- **Tests (post-launch):** A/B trust-badge placement, CTA copy ("Claim slot" vs "Join split"), countdown box vs line.
