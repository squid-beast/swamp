import { describe, expect, it } from "vitest";
import {
  buildDeliveryBody,
  defaultMessage,
  renderTemplate,
} from "@/features/tables/webhook-format";

// The bytes that go on the wire are decided here, so these pin the shapes Slack
// and Discord require, the placeholder rules, and the truncation limits.

const payload = {
  event: "record.created",
  baseId: "b1",
  tableId: "t1",
  recordId: "r1",
  record: { id: "r1", fields: { fld_name: "Acme", fld_email: "a@b.com", fld_empty: "" } },
  actor: "u1",
  timestamp: "2026-07-21T00:00:00Z",
};

describe("renderTemplate", () => {
  it("resolves top-level tokens", () => {
    expect(renderTemplate("{{event}} for {{recordId}}", payload)).toBe(
      "record.created for r1"
    );
  });

  it("resolves fields.<key> against the record's field bag", () => {
    expect(renderTemplate("Lead: {{fields.fld_name}} <{{fields.fld_email}}>", payload)).toBe(
      "Lead: Acme <a@b.com>"
    );
  });

  it("renders an unknown token as empty rather than throwing", () => {
    expect(renderTemplate("[{{fields.nope}}][{{missing}}]", payload)).toBe("[][]");
  });

  it("stringifies a non-scalar value", () => {
    const p = { obj: { a: 1 } };
    expect(renderTemplate("{{obj}}", p)).toBe('{"a":1}');
  });
});

describe("defaultMessage", () => {
  it("leads with the event and lists non-empty fields", () => {
    const msg = defaultMessage(payload);
    expect(msg).toContain("New record.created in Swamp");
    expect(msg).toContain("fld_name: Acme");
    expect(msg).toContain("fld_email: a@b.com");
    // Empty values are skipped.
    expect(msg).not.toContain("fld_empty");
  });

  it("uses a comment body when there is no record", () => {
    const msg = defaultMessage({ event: "comment.created", comment: { id: "c1", body: "hi there" } });
    expect(msg).toContain("New comment.created in Swamp");
    expect(msg).toContain("hi there");
  });
});

describe("buildDeliveryBody", () => {
  it("generic sends the raw payload envelope unchanged", () => {
    const body = buildDeliveryBody("generic", null, payload);
    expect(JSON.parse(body)).toEqual(payload);
  });

  it("slack wraps the message in { text }", () => {
    const body = JSON.parse(buildDeliveryBody("slack", "Hi {{fields.fld_name}}", payload));
    expect(body).toEqual({ text: "Hi Acme" });
  });

  it("discord wraps the message in { content }", () => {
    const body = JSON.parse(buildDeliveryBody("discord", "Hi {{fields.fld_name}}", payload));
    expect(body).toEqual({ content: "Hi Acme" });
  });

  it("falls back to the default message when no template is set", () => {
    const body = JSON.parse(buildDeliveryBody("slack", null, payload));
    expect(body.text).toContain("New record.created in Swamp");
  });

  it("truncates a Discord message to 2000 chars", () => {
    const long = "x".repeat(5000);
    const body = JSON.parse(buildDeliveryBody("discord", long, payload));
    expect(body.content.length).toBe(2000);
  });

  it("truncates a Slack message to 3000 chars", () => {
    const long = "y".repeat(5000);
    const body = JSON.parse(buildDeliveryBody("slack", long, payload));
    expect(body.text.length).toBe(3000);
  });
});
