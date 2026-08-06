import * as React from "react";
import { describe, expect, it } from "vitest";
import { render } from "@testing-library/react";
import { Markdown } from "@/features/tables/components/markdown";

// The one property that matters: raw text NEVER reaches the DOM as HTML.
// Everything else is nice-to-have formatting.

describe("Markdown", () => {
  it("never renders HTML from the value", () => {
    const { container } = render(<Markdown text={'<img src=x onerror=alert(1)>'} />);
    expect(container.querySelector("img")).toBeNull();
    expect(container.textContent).toContain("<img");
  });

  it("renders bold, italic and code", () => {
    const { container } = render(<Markdown text={"**b** *i* `c`"} />);
    expect(container.querySelector("strong")?.textContent).toBe("b");
    expect(container.querySelector("em")?.textContent).toBe("i");
    expect(container.querySelector("code")?.textContent).toBe("c");
  });

  it("renders links with a safe rel, http(s) only", () => {
    const { container } = render(
      <Markdown text={"[ok](https://example.com) [bad](javascript:alert(1))"} />
    );
    const links = container.querySelectorAll("a");
    expect(links).toHaveLength(1);
    expect(links[0].getAttribute("href")).toBe("https://example.com");
    expect(links[0].getAttribute("rel")).toContain("noopener");
  });

  it("keeps ** inside backticks literal", () => {
    const { container } = render(<Markdown text={"`**not bold**`"} />);
    expect(container.querySelector("strong")).toBeNull();
    expect(container.querySelector("code")?.textContent).toBe("**not bold**");
  });

  it("renders bullet and numbered lists", () => {
    const { container } = render(<Markdown text={"- a\n- b\n1. c"} />);
    expect(container.querySelectorAll("ul li")).toHaveLength(2);
    expect(container.querySelectorAll("ol li")).toHaveLength(1);
  });
});
