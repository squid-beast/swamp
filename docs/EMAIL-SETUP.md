# Email setup — everything, with Resend (free)

This gets every SWAMP email working and coming from **your own address, `hello@swampy.app`**: sign-up confirmation, password reset, and workspace invites. It uses **Resend's free tier** (3,000 emails/month, no card).

> **One address for everything.** SWAMP sends from `hello@swampy.app` — the same mailbox you already have at Hostinger. That means when someone replies to an invite or a reset email, it lands in your real inbox. You don't need a separate `noreply@`.

---

## First, understand who sends what

There are two senders, and **one Resend key covers both**:

| Email | Sent by | How |
|---|---|---|
| **Sign-up confirmation** | Supabase | Supabase SMTP → Resend |
| **Password reset** | Supabase | Supabase SMTP → Resend |
| **Workspace invite** ("you've been invited") | The SWAMP app | Resend API |

So there are two places to plug the same Resend key in: the **Supabase dashboard** (for auth emails) and your **Vercel env vars** (for invite emails).

There's also a third, separate thing — **receiving** mail at `hello@swampy.app` — which is just a free forwarder at Hostinger. Covered at the end.

---

## Step 1 — Resend account + verify your domain

1. Sign up at **[resend.com](https://resend.com)** (free, no card).
2. **Domains → Add Domain → `swampy.app`.**
3. Resend shows you **DNS records** (an MX record and a few TXT records — SPF and DKIM). Add each one at **Hostinger → hPanel → Domains → swampy.app → DNS Records**, exactly as shown.
4. Back in Resend, click **Verify**. It goes green in a few minutes to an hour (DNS takes time).

> DKIM/SPF are what stop your emails landing in spam. Skipping this "works" but every email goes to junk — so don't skip it.

## Step 2 — Get the API key

Resend → **API Keys → Create** → copy it (starts with `re_`). This one key is used in both places below.

## Step 3 — Invite emails (the app) → Vercel

Vercel → Project → **Settings → Environment Variables** (Production), add:

```
RESEND_API_KEY = re_...your key...          ← Sensitive
EMAIL_FROM     = SWAMP <hello@swampy.app>
```

Then **redeploy**. That's it — when you invite someone from the Members page, they now get the branded invite email with the accept link. (Without the key, invites still work; you just copy the link yourself.)

## Step 4 — Auth emails (Supabase) → custom SMTP

Supabase → **Project Settings → Authentication → SMTP Settings** → enable **Custom SMTP**:

| Field | Value |
|---|---|
| Host | `smtp.resend.com` |
| Port | `465` |
| Username | `resend` |
| Password | your Resend API key (`re_...`) |
| Sender email | `hello@swampy.app` |
| Sender name | `SWAMP` |

Save. Now sign-up and password-reset emails go through Resend, from `hello@swampy.app`.

## Step 5 — Use the branded templates

Supabase → **Authentication → Email Templates**. For each, paste the matching file from this repo:

- **Confirm signup** → paste [`docs/email/confirm-signup.html`](./email/confirm-signup.html)
- **Reset password** → paste [`docs/email/reset-password.html`](./email/reset-password.html)

(Leave the "Magic Link" and "Change Email" templates as they are — SWAMP doesn't use magic links, and the change-email default is fine.)

## Step 6 — Receiving is already done

You already have a real **`hello@swampy.app` mailbox at Hostinger**, so anything sent to that address — including replies to sign-up, reset, and invite emails — lands in your Hostinger inbox automatically. Nothing to set up here.

(Resend only *sends*; your Hostinger mailbox does the *receiving*. Because you send and receive from the same address, replies just work.)

---

## One DNS thing to know

Both Hostinger (your mailbox) and Resend (app sending) want DNS records on `swampy.app`. They don't conflict — Resend puts its records on a `send.swampy.app` subdomain, and Hostinger's mailbox records stay on the root. **Add Resend's records alongside Hostinger's; don't delete anything Hostinger created.**

---

## Test it end to end

1. **Sign up** with a real email → the confirmation email arrives, from `hello@swampy.app`, branded.
2. **Forgot password** → the reset email arrives with a working link.
3. From a base's **Members** page, **invite** a second address → the invite email arrives with an accept button.
4. **Reply** to any of them → it lands in your Hostinger inbox.

If an email doesn't arrive: check the **Resend dashboard → Emails** log (it shows every send and any bounce), and confirm the domain is **Verified**.

---

## What this costs

**Nothing.** Resend free tier is 3,000 emails/month, Hostinger forwarding is included with your domain, and Supabase custom SMTP is free. You only pay if you outgrow 3,000 emails a month — a good problem to have.
