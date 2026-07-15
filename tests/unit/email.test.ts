import { describe, expect, it } from "vitest";
import { inviteEmail } from "@/shared/email/templates";

// ════════════════════════════════════════════════════════════════════════════
// The one email SWAMP composes itself: the base invite.
//
// The auth emails (sign-up, reset, change-email) are Supabase's, rendered from the
// templates in docs/email/ — there's nothing to unit-test there. This one is built
// in code, so it's the one that can silently lose the link or the branding.
// ════════════════════════════════════════════════════════════════════════════

const URL_ = "https://swampy.app/invite/abc123token";

describe("the invite email", () => {
  it("carries the accept link — twice, button and plain-text fallback", () => {
    const { html } = inviteEmail({ url: URL_, role: "editor", baseName: "CRM" });
    // Once in the button href, once as a copyable link — corporate mail clients
    // strip the button, so the raw URL has to be there too.
    const hits = html.split(URL_).length - 1;
    expect(hits).toBeGreaterThanOrEqual(2);
  });

  it("names the base in the subject, so it isn't just 'you were invited'", () => {
    expect(inviteEmail({ url: URL_, role: "editor", baseName: "Sales" }).subject).toContain("Sales");
  });

  it("falls back gracefully when there's no base name", () => {
    const { subject, html } = inviteEmail({ url: URL_, role: "viewer", baseName: null });
    expect(subject).toMatch(/workspace/i);
    expect(html).toContain(URL_);
  });

  it("spells the role out in plain words instead of jargon", () => {
    // "you'll be able to edit" — not "added as an editor", which means nothing to
    // someone who's never used the product.
    expect(inviteEmail({ url: URL_, role: "editor", baseName: "X" }).html).toContain("edit");
    expect(inviteEmail({ url: URL_, role: "viewer", baseName: "X" }).html).toContain("view");
  });

  it("includes the logo, so the email is branded", () => {
    // The logo is a hosted absolute URL (email clients can't do inline SVG or local
    // paths). It just has to be an https image reference.
    expect(inviteEmail({ url: URL_, role: "editor", baseName: "X" }).html).toMatch(
      /<img[^>]+src="https?:\/\/[^"]+\/logo\.png"/
    );
  });
});
