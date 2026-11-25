# Cloudflare Turnstile Setup Guide

This guide covers configuring Cloudflare Turnstile for Bantai across Vercel (frontend + backend), Supabase Auth, and local development—without requiring a custom domain, Cloudflare DNS proxy, or paid Cloudflare plan.

---

## 1. Register Your Widget in Cloudflare

1. Open the **Cloudflare Dashboard → Turnstile → Add Widget**.
2. **Widget mode:** Select **Managed**.
3. **Hostnames to register:**
   - `bantaispace.vercel.app` (production frontend)
   - `localhost` (local Vite dev server)
   - `127.0.0.1` (optional local loopback)
   > Note: You do **not** need a custom domain or Cloudflare DNS proxy to use Turnstile on `bantaispace.vercel.app`.
4. Copy the generated **Site Key** (public) and **Secret Key** (private).

---

## 2. Environment Variables

### Frontend (Vercel Project Settings → Environment Variables)

Vercel restricts client-exposed `VITE_*` variables in this workspace, so configure:

```env
TURNSTILE_SITE_KEY=<your_cloudflare_public_site_key>
```

- `frontend/vite.config.ts` uses `loadEnv()` and `define` to embed **only** `TURNSTILE_SITE_KEY` into `import.meta.env.VITE_TURNSTILE_SITE_KEY` at build time.
- Never add `TURNSTILE_SECRET_KEY` to the frontend Vercel project.

### Backend (Express Vercel Project Settings → Environment Variables)

```env
TURNSTILE_SECRET_KEY=<your_cloudflare_private_secret_key>
# Optional comma-separated override (defaults to bantaispace.vercel.app, localhost, 127.0.0.1, and APP_ORIGIN host):
# TURNSTILE_EXPECTED_HOSTNAMES=bantaispace.vercel.app,localhost,127.0.0.1
```

### Local Development (`.env`)

- **Frontend (`frontend/.env`):**
  ```env
  TURNSTILE_SITE_KEY=1x00000000000000000000AA
  ```
- **Backend (`backend/.env`):**
  ```env
  TURNSTILE_SECRET_KEY=1x0000000000000000000000000000000AA
  ```
  (Official Cloudflare dummy test keys above always pass in local dev/testing.)

---

## 3. Enable Turnstile CAPTCHA in Supabase Auth

1. Open **Supabase Dashboard → Authentication → Attack Protection** (or **Settings → Bot and Abuse Protection**).
2. Enable **Turnstile** CAPTCHA protection.
3. Paste your Cloudflare **Secret Key** and save.

---

## 4. Verification Architecture (No Double-Verification)

Turnstile tokens are **single-use**. Bantai routes each flow through the single authoritative verifier responsible for that operation:

| Workflow | Handler | Verification Method |
| --- | --- | --- |
| **Registration** (`/register`) | Supabase Auth (`signUp`) | Supabase native CAPTCHA (`options.captchaToken`) |
| **Email/Password Sign-In** (`/login`) | Express `POST /auth/login` → Supabase `signInWithPassword` | Forwarded to Supabase native CAPTCHA (`options.captchaToken`) by default (or Express Siteverify if `TURNSTILE_VERIFY_LOGIN_IN_EXPRESS=true`) |
| **Forgot Password / Recovery Request** (`/password/forgot`) | Supabase Auth (`resetPasswordForEmail`) | Supabase native CAPTCHA (`options.captchaToken`) |
| **Email Verification OTP Resend** (`/email/verify`) | Supabase Auth (`resend`) | Supabase native CAPTCHA (`options.captchaToken`) |
| **Custom Express Verification** (`POST /auth/turnstile/verify`) | Express `requireTurnstile()` | Cloudflare Siteverify API (`TURNSTILE_SECRET_KEY`) + Security Center logging |
| **Google OAuth** | Supabase Auth (`signInWithOAuth`) | Preserved without Turnstile friction |
| **Organization Creation** | Express `/organizations` | Authenticated + RBAC + rate limiting (no Turnstile needed) |

---

## 5. Redeploy & Validate

1. **Redeploy Frontend** on Vercel after adding `TURNSTILE_SITE_KEY` so Vite embeds the key into the production bundle.
2. **Redeploy Backend** on Vercel after adding `TURNSTILE_SECRET_KEY`.
3. **Validate in Production (`https://bantaispace.vercel.app`):**
   - Visit `/login`, `/register`, `/password/forgot`, and `/email/verify` in both desktop and mobile viewports.
   - Confirm the Turnstile widget loads cleanly, submit buttons stay disabled until verification completes, failed submissions auto-reset the widget, and Google OAuth continues redirecting normally.
   - Check **Admin → Security Center** for any `turnstile_verification_failed` events if a challenge is rejected.
