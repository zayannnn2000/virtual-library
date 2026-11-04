# Virtual Library — going live

## 1. Supabase project
1. supabase.com → New project → name `virtual-library`, Free plan, nearest region.
2. Project Settings → API: copy the **Project URL** and the **anon / publishable** key.
   Never put the `service_role` / secret key in the app.

## 2. Database + storage
1. Supabase → **SQL Editor** → New query → paste all of [`supabase/setup.sql`](supabase/setup.sql) → **Run**.
   It creates a private `records` table and a private `library` file bucket, both locked to the signed-in user.
2. Supabase → **Authentication → Sign In / Providers**: keep **Email** on (magic links need nothing else).
3. Supabase → **Authentication → URL Configuration**: set **Site URL** to the live address from step 4,
   and add it (plus `http://localhost:5173`) under **Redirect URLs**.
4. After you've set your PIN once: **Authentication → Sign In / Providers → turn off "Allow new users to sign up"**,
   so nobody else can make an account on your library.

## 3. Connect the app
Create `.env.local` in this folder:

```
VITE_SUPABASE_URL=https://YOUR-PROJECT.supabase.co
VITE_SUPABASE_ANON_KEY=YOUR-ANON-OR-PUBLISHABLE-KEY
```

Then `npm run build`. Without these values the app still works, saved on one device only.

### Free & open books (Add book → "Find it free & open")
Searches Internet Archive, Google Books, OAPEN and DOAB. "Add & Read" only lights up when a whole PDF/EPUB is
really there and free to keep (public domain or an open licence); borrow-only, preview and restricted books
get "Upload your copy" instead. Files come through the app's own backend (`api/fetch-book.ts`, run by Vercel;
the same code runs in `npm run dev` / `preview`), which only talks to those sources and checks every file.

- **Internet Archive** — works with no setup.
- **Google Books** — needs a free API key, because the shared keyless allowance is used up most days:
  1. console.cloud.google.com → create a project → **APIs & Services → Library** → enable **Books API**.
  2. **Credentials → Create credentials → API key**. Restrict it: *Application restrictions* → **Websites**,
     add your Vercel address (e.g. `https://your-project.vercel.app/*`) and `http://localhost:5173/*`;
     *API restrictions* → **Books API** only.
  3. Add `VITE_GOOGLE_BOOKS_KEY=…` to `.env.local` and to Vercel's environment variables, then rebuild.
- **OAPEN / DOAB** — their REST API only answers addresses they've approved, so it shows as
  "only answers approved servers" for now. To use it, ask OAPEN for API access for your site
  (contact details on oapen.org); until then the rest of the search works without it.

## 4. Host it (Vercel, free Hobby plan)
1. From this folder: `npx vercel` — it opens a browser for you to sign in, then asks a few questions
   (accept the defaults; Vercel detects Vite and builds with `npm run build` into `dist`).
2. In the Vercel dashboard → the project → **Settings → Environment Variables**, add
   `VITE_SUPABASE_URL` and `VITE_SUPABASE_ANON_KEY` (same values as `.env.local`) for **Production**.
3. Deploy to production: `npx vercel --prod`. You get an address like `your-project.vercel.app`
   (Settings → Domains lets you rename it).
4. Put that address into Supabase (step 2.3).

Redeploy after any change: `npx vercel --prod`.

## Who owns what
- The code, the Supabase project and the Vercel project are all on **your** accounts; a reader only needs the URL.
- The reader unlocks with a PIN on each device. Their books and notes are private to that login —
  but as the Supabase project owner you can technically see the stored data in the dashboard.
- Keep the free tiers healthy: Supabase pauses free projects after about a week with no activity;
  regular reading keeps it awake, and a paused project can be resumed from the dashboard.

## How sync behaves
- Everything is saved on the device first, so reading works offline; changes sync in the background
  (on every edit, when the tab comes back, when the connection returns, and every minute).
- If the same thing is edited on two devices, the most recent edit wins.
- Ebook files upload once; another device downloads a book the first time it's opened there.
- Free tier: 1 GB of files (roughly 100–200 typical ebook PDFs).
- "Sign out of this device" (☰ menu) removes the local copy; the library stays in the account.
