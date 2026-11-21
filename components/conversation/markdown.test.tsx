import { describe, expect, it } from "vitest"
import { renderToStaticMarkup } from "react-dom/server"

import { Markdown } from "./markdown"

/**
 * Security and formatting contracts for the conversation Markdown
 * renderer, exercised through server-side rendering: model content is
 * untrusted, so dangerous URLs, raw HTML, and remote images must never
 * become live output.
 */

function render(content: string): string {
  return renderToStaticMarkup(<Markdown content={content} />)
}

describe("markdown security", () => {
  it("neutralizes javascript: URLs in links", () => {
    const html = render("[click](javascript:alert(1))")
    expect(html).not.toContain("javascript:")
    expect(html).not.toContain("<a ")
  })

  it("never renders raw HTML from the model", () => {
    const html = render('<img src="https://evil.example/x.png"><b>bold</b>')
    expect(html).not.toContain("<img")
    // Raw markup surfaces as inert text instead.
    expect(html).toContain("&lt;img")
  })

  it("drops model-provided images entirely", () => {
    const html = render("![remote art](https://cdn.example/art.png)")
    expect(html).not.toContain("<img")
    expect(html).not.toContain("cdn.example")
  })

  it("marks external links with noopener and a blank target", () => {
    const html = render("[site](https://example.com/page)")
    expect(html).toContain('target="_blank"')
    expect(html).toContain('rel="noopener noreferrer nofollow"')
  })
})

describe("markdown formatting", () => {
  it("renders GFM tables with a scroll wrapper", () => {
    const html = render(
      "| A | B |\n| --- | --- |\n| 1 | 2 |"
    )
    expect(html).toContain("<table")
    expect(html).toContain("overflow-x-auto")
  })

  it("renders fenced code blocks with a copy affordance", () => {
    const html = render("```\nconst x = 1\n```")
    expect(html).toContain("<pre")
    expect(html).toContain("Copy code")
  })

  it("renders task lists", () => {
    const html = render("- [x] done\n- [ ] open")
    expect(html).toContain("done")
    expect(html).toContain("open")
  })

  it("keeps ordered and unordered lists", () => {
    const html = render("1. one\n2. two\n\n- bullet")
    expect(html).toContain("<ol")
    expect(html).toContain("<ul")
  })
})
