# SWAMP — market position & how to get found

An honest read of the landscape and a get-discovered plan for a brand-new site. Written the week of launch.

---

## 1. Where SWAMP sits

The "spreadsheet that's really a database" market has a clear shape:

| Tier | Who | What they own |
|---|---|---|
| **The giant** | **Airtable** | The category name. Everyone else is "an Airtable alternative." |
| **Big SaaS** | SmartSuite, Notion, ClickUp, Monday | Broad work-management, huge marketing budgets |
| **Open-source** | **NocoDB** (~63k GitHub stars), **Baserow**, **Teable** | The "own your data, self-host, no record caps" crowd |
| **You** | **SWAMP** | New. Collaborative database, Postgres underneath, honest about being young. |

**The takeaway:** you're entering as an unknown against players with 5–60k GitHub stars and years of SEO. That's fine — but it dictates the strategy below. You do **not** win by fighting for the head term "Airtable alternative" on day one.

Sources: [Zapier: best Airtable alternatives](https://zapier.com/blog/airtable-alternatives/) · [NocoBase: OSS alternatives by GitHub stars](https://www.nocobase.com/en/blog/open-source-airtable-alternatives) · [Baserow vs NocoDB](https://www.softr.io/blog/baserow-vs-nocodb)

---

## 2. The honest SEO reality

**"Airtable alternative" is locked up.** The first page is a wall of DR-70+ listicles (Zapier, Baserow, Hostinger, SmartSuite…) that update every year. A brand-new domain will not crack it for 12+ months, if ever. Don't build your hopes on it.

**So SEO is the slow lane, not the launch lane.** For the first few months, *directories, communities, and word of mouth* will send you far more traffic than Google. Section 5 is where the early wins are.

**What you CAN rank for** — long-tail, specific, lower-competition terms where the listicles don't bother:

| Keyword | Intent | Difficulty | Why it's winnable |
|---|---|---|---|
| open source airtable alternative | commercial | hard-ish | you're genuinely open source; niche enough |
| free collaborative database for small teams | commercial | medium | long-tail, under-served |
| spreadsheet that links tables | informational | easy | specific pain, few good pages |
| turn a spreadsheet into a database | informational | easy | exactly what you do |
| shared database with a public form | informational | easy | your form feature, niche |
| self-hosted airtable alternative postgres | commercial | medium | technical, matches your stack |
| simple CRM database no-code | commercial | medium | a real use-case you serve |
| `swamp` / `swampy.app` (branded) | navigational | easy | own your own name from day one |

The way you win these is **content** — a short article per term that actually answers it — which is the one thing your site doesn't have yet (you deferred the blog). It's the single highest-leverage SEO move you can make later.

---

## 3. What's already built (so you don't redo it)

Your site ships **SEO-correct** — this part is done:

- Per-page `title` (50–60 chars) + `description` (150–160), unique per page
- Canonical URLs on every page (no duplicate-content splits)
- `sitemap.xml` and `robots.txt`, generated from one source
- Open Graph + Twitter cards, with a **per-page generated OG image**
- JSON-LD: Organization, WebSite, SoftwareApplication, **FAQPage**, Breadcrumbs
- Server-rendered pages → fast Core Web Vitals (no heavy JS to first paint)
- Auth/app/share pages `noindex`'d so they don't pollute the index

You don't need to touch any of it. It's the 20% that most launches get wrong.

---

## 4. Google Search Console — do this on launch day

This is how Google learns your site exists instead of waiting to stumble on it.

1. Go to **[search.google.com/search-console](https://search.google.com/search-console)** → **Add property** → **Domain** → enter `swampy.app`.
2. It gives you a **TXT record**. Add it at **Hostinger → DNS**. Click **Verify**. (Domain-level verification covers www + all paths in one go.)
3. **Sitemaps** (left menu) → submit `https://swampy.app/sitemap.xml`.
4. **URL Inspection** → paste `https://swampy.app/` → **Request indexing**. Do the same for `/about` and `/security`.
5. Come back in a week: **Pages** shows what's indexed, **Performance** shows what you're appearing for.

Also worth 5 minutes: **[Bing Webmaster Tools](https://www.bing.com/webmasters)** — same idea, and you can import straight from Search Console. Bing also feeds ChatGPT search.

---

## 5. Get discovered — the actual launch levers (mostly free)

For a new tool, these beat SEO for months. In rough priority:

1. **Directories & "alternative to" sites** — these rank for the terms you can't yet, and link to you:
   - [AlternativeTo](https://alternativeto.net) — add SWAMP as an Airtable alternative
   - [openalternative.co](https://openalternative.co) — open-source software directory
   - [awesome-selfhosted](https://github.com/awesome-selfhosted/awesome-selfhosted) — submit a PR
   - SaaS directories: SaaSHub, Product Hunt's alternatives pages
2. **Product Hunt launch** — one good launch = a spike of signups + a permanent backlink. Prepare: the logo (done), a 3-line pitch, a GIF of importing a CSV. Pick a Tuesday–Thursday.
3. **GitHub** — since you're open source, the repo IS marketing. A clear README (done), a topic tag (`airtable-alternative`, `database`, `nocode`), and it starts showing up in GitHub search and the OSS listicles.
4. **Communities** — where your users already complain about spreadsheets: r/selfhosted, r/nocode, r/smallbusiness, Indie Hackers, relevant Discords. Don't spam — answer "what should I use instead of a giant Google Sheet?" threads with a genuine "I built this."
5. **One comparison page on your own site later** — "SWAMP vs Airtable" / "vs a spreadsheet." These rank and convert, and you control the framing.

---

## 6. The 30-day plan

**Launch week**
- [ ] Deploy to `swampy.app`, confirm it loads + sign-in works
- [ ] Google Search Console: verify, submit sitemap, request indexing (§4)
- [ ] Bing Webmaster Tools: import from GSC
- [ ] Add SWAMP to AlternativeTo + openalternative.co (§5.1)
- [ ] GitHub repo: topics, description, link to swampy.app

**Weeks 2–4**
- [ ] Product Hunt launch (prep the assets first)
- [ ] Post in 2–3 communities where the pain lives
- [ ] Write **one** long-tail article (start with "turn a spreadsheet into a database") — this is the SEO seed
- [ ] Check Search Console Performance: what are you appearing for? Write the next article about that.

**The honest expectation:** SEO traffic is near-zero for the first 1–3 months regardless of what you do — that's normal for a new domain. Your early users come from directories, Product Hunt, and communities. SEO compounds later, *if* you keep publishing. One article a week for three months is worth more than any amount of meta-tag tweaking.

---

## 7. What NOT to waste time on

- **Chasing "Airtable alternative" head term.** Not winnable yet. Ignore it.
- **Buying backlinks / SEO "packages."** Get you penalized, not ranked.
- **Meta-keyword stuffing.** Google ignores the keywords tag; your on-page SEO is already correct.
- **A second domain, an .io, etc.** One domain, all your authority in one place.
