# Virtual Library

A cosy digital bookshelf and e-reader that runs in the browser — on a laptop or a phone.

- **A real-looking bookshelf** with spines, covers, categories and a "Continue reading" row.
- **Reader for PDF and EPUB** with a paper page-curl when you turn pages, "Go to page" / chapter jumping,
  highlights (with an eraser), sticky notes, bookmarks and adjustable text.
- **Find free books**: searches Project Gutenberg, Internet Archive, Google Books, OAPEN and DOAB, and only
  offers a download when the whole book is legitimately free (public domain or an open licence).
- **Diary-style lock screen** with a 4-digit PIN, and optional sync across devices with Supabase.
- Works offline: everything is saved on the device first (IndexedDB).

Built with Vite, React 19 and TypeScript; pdf.js and epub.js for reading; Dexie for storage; Supabase for sync.

## Run it locally

```bash
npm install
npm run dev
```

Then open http://localhost:5173. With no settings it runs as a local-only library on that device (no PIN, no sync).

## Settings (optional)

Copy `.env.example` to `.env.local` and fill in what you want:

| Variable | What it's for |
| --- | --- |
| `VITE_SUPABASE_URL`, `VITE_SUPABASE_ANON_KEY` | Sync + PIN lock across devices (see `SETUP.md`) |
| `VITE_LIBRARY_EMAIL` | The account email the PIN signs in to (used for "Forgot PIN?") |
| `VITE_GOOGLE_BOOKS_KEY` | Google Books search (free key from Google Cloud) |

`.env.local` is git-ignored — never commit real keys, and never use Supabase's `service_role` key in the app.

## Deploy

See [`SETUP.md`](SETUP.md) for Supabase and Vercel. The `api/` folder holds the small serverless backend
(book downloads and open-access search), which Vercel runs automatically.
