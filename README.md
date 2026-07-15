# SWAMP

**The shared database your team can actually use.**

SWAMP turns a spreadsheet into a real, shareable database — without any setup. Drop your data in, and you get something you can filter, organize, share, and work on together. Live at **[swampy.app](https://swampy.app)**.

---

## The idea

Every team's data starts in a spreadsheet, and every spreadsheet eventually falls apart — the moment a second person opens it, the moment one column needs to point at another sheet, the moment someone pastes over a formula and nobody can tell what changed.

Most tools make you *model* your data before you can even look at it. SWAMP flips that: **put the data in first, and the structure comes out the other side.**

---

## What you can do

### 📥 Bring your data in
Import a **CSV, Excel, or JSON** file and every column is understood automatically — a phone number stays a phone number, a zip code stays a zip code, a date becomes a date. No "define your schema" step, no mapping screens. You have a working database in about a minute.

### 👀 See it five ways
It's one set of records, and you choose how to look at it:

- **Grid** — a familiar spreadsheet
- **Board** — drag cards between columns (like a Kanban board)
- **Gallery** — cards with cover images
- **Calendar** — anything with a date, laid out on a month
- **Form** — a page other people can fill in

Change the data in one view and it updates everywhere, because there's only ever one set of records underneath.

### 🔗 Make it an actual database
- **Link tables together** — a deal points to a company, a task to a project
- **Roll up numbers automatically** — the total value of a company's deals, kept up to date for you
- **Formulas** — compute a value from a record's other fields
- **Rename anything, anytime** — nothing downstream breaks

### ⌨️ Edit like a spreadsheet
Arrow keys, Tab, Enter to edit. **Copy and paste to and from Excel or Google Sheets.** A fill handle that continues a series. And **undo for everything** — every change can be taken back.

### 👥 Work together
- **Invite people at the right level** — from view-only, to comment-only, to full editing, to admin
- **Comment on any row** — ask a question without being able to break anything
- **See who changed what, and when** — a clear history, field by field
- **Everyone's edits appear live** — no refreshing, no emailing versions around

### 🌍 Share with anyone
- Send a **read-only link** to a view, with a password if you want one. Columns you hide stay hidden — visitors can't see or dig them out.
- Collect answers with a **form** — the person filling it in doesn't need an account.

### 📎 Attach files
Drag files straight onto a record. They're stored privately — only the people you've invited can open them.

### 🔌 Connect it to your other tools
- A clean **API** to read and write your data from a script or another app
- **Webhooks** that notify another tool the moment something changes — and only when the thing you care about changes
- **Buttons** on a record that open a link or trigger an action

### 🔒 Your data stays yours
Your information is protected at the deepest level, so people only ever see what they're meant to. And there's **no lock-in** — export any view to a spreadsheet, or pull everything through the API, whenever you like.

---

## Getting started

1. Go to **[swampy.app](https://swampy.app)**
2. Sign in with **Google**, or an **email and password**
3. **Import a file** — and you're looking at your data as a real database

## What it costs

**Free while it's in beta.** No card required. When pricing arrives, there'll be a free tier, and it'll be announced before anything changes.

## Where it's early

SWAMP is young and honest about it. It's still in beta, there's no third-party security audit yet, and a few advanced pieces are still being polished. The [security page](https://swampy.app/security) says exactly what is and isn't done — nothing on the site claims more than the product actually does.

## Get in touch

Questions, bugs, ideas → **hello@swampy.app**

Built in the open by [Squid-Beast](https://github.com/squid-beast).

---

<sub>**For developers:** running or deploying SWAMP yourself is documented under [`docs/`](./docs) — start with [DEPLOYMENT-GUIDE.md](./docs/DEPLOYMENT-GUIDE.md) and [ENVIRONMENTS.md](./docs/ENVIRONMENTS.md). The architecture and product spec live in [ARCHITECTURE.md](./ARCHITECTURE.md) and [docs/SPEC.md](./docs/SPEC.md).</sub>
