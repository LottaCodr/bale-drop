import { describe, expect, it } from "vitest";
import { POLICIES, policyBySlug } from "@/lib/policies";
import { TOPIC_LABELS, SUPPORT_TOPICS, listSupportMessages, sendSupportMessage } from "@/lib/support";

/**
 * Trust surfaces are load-bearing: the FCCPA gives buyers transparency and
 * refund rights that only exist if they are written down and reachable. These
 * tests keep the pages linked, populated and honest about the numbers the code
 * actually enforces.
 */
describe("policies", () => {
  it("exposes the four customer-facing policies, each addressed from the footer", () => {
    expect(POLICIES.map((policy) => policy.slug).sort()).toEqual(["delivery", "privacy", "refunds", "terms"]);
    for (const policy of POLICIES) {
      expect(policy.title.length).toBeGreaterThan(3);
      expect(policy.summary.length).toBeGreaterThan(30);
      expect(policy.sections.length).toBeGreaterThanOrEqual(3);
      for (const section of policy.sections) {
        expect(section.heading.length).toBeGreaterThan(3);
        expect(section.body.length).toBeGreaterThan(0);
        for (const paragraph of section.body) expect(paragraph.length).toBeGreaterThan(40);
      }
    }
  });

  it("documents the escrow mechanics the code enforces", () => {
    const refunds = policyBySlug("refunds");
    const text = JSON.stringify(refunds);
    expect(text).toContain("48 hours"); // orders auto-release window
    expect(text).toContain("Disputes & refunds"); // where the button lives
    const delivery = policyBySlug("delivery");
    expect(JSON.stringify(delivery)).toContain("before you pay"); // FCCPA price transparency
  });

  it("returns undefined for an unknown slug so the route can 404", () => {
    expect(policyBySlug("everything-free")).toBeUndefined();
  });
});

describe("support", () => {
  it("labels every topic", () => {
    for (const topic of SUPPORT_TOPICS) expect(TOPIC_LABELS[topic]).toBeTruthy();
  });

  it("no-ops in demo mode so the form still works without a database", async () => {
    await expect(
      sendSupportMessage({
        name: "Adaeze",
        email: "adaeze@example.com",
        topic: "order",
        body: "My bale arrived with fewer pieces than the listing promised.",
        orderRef: "BD-2019",
      })
    ).resolves.toBeUndefined();
    await expect(listSupportMessages()).resolves.toEqual([]);
  });
});
