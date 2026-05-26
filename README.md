# Jozik Capital

Investment platform frontend (HTML/CSS/JS) with Supabase authentication and profiles.

## Setup

1. **Supabase SQL**  
   Open [Supabase SQL Editor](https://supabase.com/dashboard/project/vtvxcqugigtznzkfoevm/sql) and run the full contents of `supabase/schema.sql`.

2. **Auth settings** (Supabase Dashboard → Authentication → URL Configuration)  
   - Site URL: your deployed site URL (or `http://localhost:5500` for local testing)  
   - Redirect URLs: add `login.html` path for password reset  

3. **Logo**  
   Logo: `images/logo.jpg` (falls back to `images/logo.svg` if missing).  
   **WhatsApp link preview:** `index.html` includes Open Graph tags pointing to  
   `https://frenchkiz.github.io/jozik/images/logo.jpg`. After deploying, refresh the cache at  
   [Facebook Sharing Debugger](https://developers.facebook.com/tools/debug/) (enter your site URL), then share again on WhatsApp.

4. **Run locally**  
   Serve the folder with any static server, e.g.  
   `npx serve .`  
   or VS Code Live Server.

## Admin: update user balance

1. Supabase → **Table Editor** → `profiles`  
2. Edit `balance` (shown as USD on dashboard) and/or `total_invested` (feeds referrer `team_accumulation`)  
3. Optionally set `level`, `monthly_team_accumulation` manually  

## Project structure

- `index.html` — marketing homepage  
- `signup.html` / `login.html` — auth  
- `dashboard.html` — investor dashboard  
- `terms.html` — terms & conditions  
- `supabase/schema.sql` — database, triggers, RLS  
- `js/config.js` — Supabase client & helpers  
