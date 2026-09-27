import { describe, expect, it } from "vitest";
import { friendlyErrorMessage } from "../errors";

describe("friendlyErrorMessage", () => {
  it("turns row-level security errors into seller-friendly listing copy", () => {
    expect(
      friendlyErrorMessage(
        { message: 'new row violates row-level security policy for table "products"' },
        { context: "listing" }
      )
    ).toBe(
      "Your seller account must be approved before you can submit listings. If you were already approved, sign in again and try once more."
    );
  });

  it("uses the page context instead of exposing database syntax errors", () => {
    expect(
      friendlyErrorMessage(
        { message: "invalid input syntax for type uuid: not-a-real-id" },
        { context: "address" }
      )
    ).toBe("We couldn’t save that address. Please check the details and try again.");
  });

  it("keeps copy that is already clear and actionable", () => {
    expect(friendlyErrorMessage("Enter your shop name.", { context: "vendorApplication" })).toBe("Enter your shop name.");
  });

  it("turns session errors into a sign-in prompt", () => {
    expect(friendlyErrorMessage("session expired — sign in again", { context: "payment" })).toBe(
      "Your session expired. Sign in again to continue."
    );
  });
});
