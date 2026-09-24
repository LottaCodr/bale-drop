/**
 * Customer-facing policies, in one place.
 *
 * These pages are a launch blocker, not decoration: the FCCPA 2018 gives a
 * Nigerian buyer the right to clear price information, to cancel an advance
 * order, and to a refund when goods are not as described. Those rights are only
 * usable if they are written down and reachable, and they must describe what the
 * code actually does — the escrow release window below is the same 48 hours
 * enforced by `orders.timeout`/`release_escrow`, the dispute window is the one
 * `/orders` offers, and the delivery-fee disclosure is the line item checkout
 * shows before the pay button.
 *
 * Keep every number in this file traceable to code or a migration. If the code
 * changes, this file changes in the same PR.
 */

export type PolicySlug = "terms" | "privacy" | "refunds" | "delivery";

export interface PolicySection {
  heading: string;
  /** One paragraph or a short list — kept plain-language on purpose. */
  body: string[];
}

export interface Policy {
  slug: PolicySlug;
  title: string;
  summary: string;
  updated: string;
  sections: PolicySection[];
}

export const POLICY_UPDATED = "24 September 2026";

export const POLICIES: Policy[] = [
  {
    slug: "terms",
    title: "Terms of service",
    summary:
      "Who Bale Drop is, what vendors and buyers agree to, and the rules that keep a split fair for everyone.",
    updated: POLICY_UPDATED,
    sections: [
      {
        heading: "What Bale Drop is",
        body: [
          "Bale Drop is a marketplace. Vendors list bales and graded pieces; we host the listing, take the payment, hold it while delivery happens, and pass the vendor's share on once the order is confirmed. We are not the seller of the goods and we do not own the stock.",
          "You need an account to buy or sell. You are responsible for the accuracy of the details on it, and you must be at least 18 to sell.",
        ],
      },
      {
        heading: "Bale splits",
        body: [
          "A split lets several buyers share one bale at a per-slot price. Joining a split reserves a slot for 10 minutes while you pay; unclaimed or unpaid slots return to the pool automatically.",
          "If a split does not fill before its deadline, it closes and every paid buyer is refunded in full, automatically. Nobody pays more than their slot price plus the delivery fee shown at checkout.",
        ],
      },
      {
        heading: "Vendor obligations",
        body: [
          "Grade honestly. The A/B/C grade you declare is what a buyer is paying for, and a mismatch is a refundable dispute.",
          "Dispatch within your stated window, keep stock counts accurate, and do not relist stock that is already committed to a paid order. Repeated grade mismatches or late dispatch remove a vendor from the marketplace.",
        ],
      },
      {
        heading: "Buyer obligations",
        body: [
          "Pay for the slot you claim within the reservation window. Inspect your delivery on arrival and confirm it — or open a dispute with evidence — inside the release window.",
          "Do not misuse the platform: no fraudulent chargebacks, no fake evidence, no automated scraping, and no attempts to take payments off-platform to avoid the escrow protections you would otherwise have.",
        ],
      },
      {
        heading: "Suspension and changes",
        body: [
          "We may suspend an account that breaks these terms, and we may change them; material changes are announced in-app before they take effect.",
          "Nigerian law governs these terms, and the courts of Lagos State have jurisdiction.",
        ],
      },
    ],
  },
  {
    slug: "privacy",
    title: "Privacy notice",
    summary:
      "What we collect, why we collect it, who sees it, and how to get it deleted.",
    updated: POLICY_UPDATED,
    sections: [
      {
        heading: "What we collect",
        body: [
          "Account: name, email, phone, and (for vendors) the identity and bank documents needed for verification.",
          "Orders: what you bought, delivery address and phone, the payment reference Paystack returns, and the chat-free audit trail of each status change.",
          "Product analytics: which pages you viewed, which filters you used, and which steps of checkout you reached. This is tied to a random session id; we do not store card numbers, and we filter personal fields out of analytics events before they are sent.",
        ],
      },
      {
        heading: "Who can see it",
        body: [
          "Vendors see only what they need to fulfil an order: the buyer's display label, the delivery address and phone, and the order contents. Buyers never see another buyer's details, and vendors cannot read your other orders.",
          "Paystack processes payments and receives the amount and reference, never your card details (they never reach our servers). Delivery partners receive the address and phone for the order they are carrying.",
          "Nobody else, unless a lawful request requires it.",
        ],
      },
      {
        heading: "How long we keep it",
        body: [
          "Order and transaction records are kept as required for accounting and dispute resolution. Analytics events are pruned after 180 days, and read notifications after 120 days.",
        ],
      },
      {
        heading: "Your controls",
        body: [
          "You can see and correct your profile and addresses in Account settings, export or close your account from the same page, and ask us to delete data we are not legally required to keep.",
          "Data requests go through Support and are answered within 30 days.",
        ],
      },
    ],
  },
  {
    slug: "refunds",
    title: "Refunds, returns and disputes",
    summary:
      "When your money is released to a vendor, what counts as a refundable problem, and how to open a dispute.",
    updated: POLICY_UPDATED,
    sections: [
      {
        heading: "Your money is held, not handed over",
        body: [
          "When you pay, Bale Drop holds the funds. The vendor is not paid until you confirm delivery or the release window closes — 48 hours after the delivery is marked complete, whichever comes first.",
        ],
      },
      {
        heading: "Refundable, in full",
        body: [
          "The split you joined never filled and the deadline passed.",
          "The listing was materially misdescribed (for example, Grade B sold as Grade A), or the item arrived damaged, incomplete, or was never delivered.",
          "The vendor cancels, or rejects the order.",
        ],
      },
      {
        heading: "How to dispute",
        body: [
          "Open Disputes & refunds from the order in Orders, before the release window closes, and attach photos or a PDF — evidence decides grade and delivery disputes fastest.",
          "We review the evidence from both sides. Refunds go back on the same payment route, and where Paystack can reverse the charge, the refund is returned to your card or transfer account within 5–10 business days of approval.",
        ],
      },
      {
        heading: "Not refundable",
        body: [
          "Change of mind after the item arrives as described — thrift stock is sold as-graded. You can also ask a vendor for a goodwill return, which they may accept at their discretion.",
          "Grade C items sold as Grade C, where the listing described the faults you are disputing.",
          "Requests raised after the release window has closed and the vendor has been paid; at that point we can only mediate, not reverse.",
        ],
      },
    ],
  },
  {
    slug: "delivery",
    title: "Delivery and fees",
    summary:
      "What delivery costs, when promo codes apply, what happens if nobody is home, and how tracking works.",
    updated: POLICY_UPDATED,
    sections: [
      {
        heading: "What you pay",
        body: [
          "Every naira is shown before you pay: item or slot price, the vendor's delivery fee, and any eligible subsidy or promo code, itemised on the checkout card next to the pay button.",
          "We never add a fee after payment. If a listing's price or availability changes while it sits in your cart, checkout tells you before you pay rather than silently repricing.",
        ],
      },
      {
        heading: "Timing",
        body: [
          "Vendors dispatch within their stated window. Within Lagos, Abuja, Port Harcourt and Kano deliveries typically arrive in 1–3 working days; other cities depend on the partner covering the route.",
          "Splits dispatch once the group fills. If the group never fills, the order is refunded in full instead of shipping late.",
        ],
      },
      {
        heading: "On the day",
        body: [
          "The courier calls the phone number on the order. If delivery fails twice, the parcel returns to the vendor's pick-up point and Support will help you rebook — a rebooking fee may apply.",
          "Track every step in Orders; the tracking reference appears there as soon as the vendor marks the parcel in transit.",
        ],
      },
    ],
  },
];

export function policyBySlug(slug: string): Policy | undefined {
  return POLICIES.find((policy) => policy.slug === slug);
}
