# SWAMP — license & originality audit

Written the week of launch, because the site is published under a real person's
name and photo (Lohith Kumar Neerukonda) and it replicates the idea of an existing
open-source product. This documents what was checked and what's safe.

**This is not legal advice.** It's an engineering audit. Anything below marked
"get a real check" should go past a lawyer before you rely on it.

---

## 1. Originality vs NocoDB (the main worry)

**Finding: clean-room. No NocoDB source was copied.**

SWAMP was built from a *behavioural* spec — what the product does, observed as a
user — not from NocoDB's code. That distinction is the whole ballgame:

- **Ideas and features are not copyrightable.** "A spreadsheet that's really a
  database, with linked tables, several views, roles, and share links" is a
  concept. Building your own version of a concept is legal and normal (every
  Airtable alternative does exactly this).
- **Code is copyrightable.** Copying NocoDB's source would be infringement — and
  because **NocoDB is AGPL-3.0**, it would also drag AGPL's copyleft obligations
  onto SWAMP. Neither applies here, because no NocoDB code is in the tree.

**Scan result:** a full search of the source found **one** mention of "NocoDB" —
a design-comparison *comment* in `supabase/migrations/20260714010000_workspace_schema.sql`
(≈ line 502: "…generated junction tables (what NocoDB does): one RLS…"). It's a
sentence explaining why SWAMP took a different approach. It is not code, and it is
not a problem. If you want zero brand mentions, reword it — otherwise it's fine.

No GPL/AGPL/LGPL license headers or `Copyright (c)` notices were found in any
source file.

**Keep doing:** never paste NocoDB (or any AGPL project's) source into this repo.

---

## 2. Dependencies — all permissive

Every runtime dependency is under a permissive license (MIT / ISC / Apache-2.0).
**No copyleft (GPL / AGPL / LGPL) anywhere in the dependency tree.**

| Package | License |
|---|---|
| next, react, react-dom | MIT |
| @radix-ui/* , shadcn-derived UI | MIT |
| framer-motion | MIT |
| lucide-react | ISC |
| @supabase/supabase-js, @supabase/ssr | MIT / Apache-2.0 |
| @tanstack/react-table, react-virtual | MIT |
| recharts, date-fns, zod, clsx, tailwind-merge | MIT |
| **xlsx (SheetJS Community)** | **Apache-2.0** (permissive — fine) |
| tailwindcss, tailwindcss-animate | MIT |

Nothing here obligates you to open your source or attach a viral license.

---

## 3. UI components (shadcn/ui, 21st.dev)

- **shadcn/ui** components (Button, Dialog, Checkbox, Badge, Accordion, etc.) are
  MIT and *designed* to be copied into your repo. That's their model. Safe.
- **The framer-motion animation pieces** (`Reveal`, `HeroBackdrop`, the animated
  nav mark, the bento grid) are **original code written for SWAMP** — not lifted
  from a component gallery — so no third-party license attaches to them.
- **The 21st.dev "case studies / gallery" demo was NOT added.** It ships with
  Unsplash images and placeholder copy; pulling those in would have added an
  attribution/licensing surface for no benefit. Skipped on purpose.

---

## 4. Assets

| Asset | Source | Status |
|---|---|---|
| Logo — `public/logo.png`, `app/icon.png`, `app/apple-icon.png` | Generated in your own Higgsfield (Nano Banana Pro) account, then processed. An abstract connected-node mark, not derived from any existing logo. | Yours to use. |
| Founder photo — `public/lohith.jpg` | Your own photo. | Yours to use. |
| Fonts — Selawik (bundled), Bricolage Grotesque, JetBrains Mono | SIL Open Font License (OFL). | Free for web + commercial use. |

No stock photos, no third-party icons beyond lucide (ISC), no copyrighted imagery.

---

## 5. Because your name and photo are on it

The About page and the Person structured data attribute the site to you publicly.
Given sections 1–4, that's fine. The two residual things worth a real check:

1. **Trademark on "SWAMP" / "swampy.app".** Copyright and trademark are different.
   Do a quick search for an existing software trademark on the name in your
   jurisdiction. *(Get a real check.)*
2. **The "open source" claim.** The marketing says SWAMP is open source. For that
   to be *true*, the repo needs an OSI-approved license file (see below). Without
   one, it's "source available," and calling it open source is inaccurate.

---

## 6. To-do before / at launch

- [ ] **Add a `LICENSE` file.** Since you market it as open source, pick an OSI
      license. **MIT** is the simplest (lets anyone reuse, keeps you clean). Choose
      **AGPL-3.0** only if you specifically want to force forks to stay open — note
      that's the same license NocoDB uses. If you do *not* want it open at all,
      change the marketing wording instead of adding a license.
- [ ] Trademark sanity-check on the name. *(Get a real check.)*
- [ ] Have the Privacy / Terms / Cookie pages reviewed before relying on them.
- [ ] Keep the clean-room rule: no AGPL source pasted in, ever.

---

## Verdict

Nothing in the codebase or assets creates a copyright exposure today. The build is
clean-room relative to NocoDB, all dependencies are permissive, and every asset is
yours or openly licensed. The open items are administrative (add a LICENSE, check
the trademark, get the legal pages reviewed), not infringement.
