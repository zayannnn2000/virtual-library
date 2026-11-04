# 📚 Virtual Library

A cosy digital bookshelf and e-reader that runs in your browser, on a laptop or a phone.

- **A real-looking bookshelf** with spines, covers, categories and a "Continue reading" row.
- **Reader for PDF and EPUB** with a paper page-curl when you turn pages, "Go to page" and chapter jumping,
  highlights (with an eraser), sticky notes, bookmarks and adjustable text.
- **Find free books**: searches Project Gutenberg, Internet Archive, Google Books, OAPEN and DOAB, and only
  offers a download when the whole book is legitimately free (public domain or an open licence).
- **Diary-style lock screen** with a 4-digit PIN, and optional sync across devices.
- **Works offline**: everything is saved on the device first.

---

## 1. Get it running on your computer

### What you need first
- **Node.js** (version 20 or newer): download the "LTS" version from https://nodejs.org and install it.
- **Git** (optional, for cloning): https://git-scm.com

### Steps
1. **Download the code.** Either:
   - click the green **Code** button on GitHub → **Download ZIP**, then unzip it, **or**
   - in a terminal: `git clone https://github.com/zayannnn2000/virtual-library.git`
2. **Open a terminal in the folder.** In VS Code: *File → Open Folder…* → pick `virtual-library`,
   then *Terminal → New Terminal*.
3. **Install the parts it needs** (only the first time, takes a minute):
   ```bash
   npm install
   ```
4. **Start it:**
   ```bash
   npm run dev
   ```
5. **Open it:** go to **http://localhost:5173** in your browser.

That's it. With no extra settings it runs as a **local-only library**: no PIN, no sync, and everything is
saved in that browser on that computer.

To stop it, click in the terminal and press **Ctrl + C**. To start it again later, run `npm run dev`.

> **On your phone (same Wi-Fi):** run `npm run dev -- --host` instead, then open the
> `Network:` address it prints (like `http://192.168.1.20:5173`) on your phone.

---

## 2. How to use it

### Opening the library
Tap the **heart lock** on the diary cover, then swipe (or tap the arrow) to turn the page and enter.

### Adding books
Tap **+ Add a book** (on the shelf or at the top). You can:
- **Upload your own** PDF or EPUB file from your device, or
- **Search free books**: type a title or author. Books marked downloadable can be added with one tap
  ("Download to shelf"). For books that aren't free, you'll see "Upload your copy" instead.

### Your shelf
- **Laptop:** hover over a spine to pull it out, click to open its card. Arrow keys browse, Enter opens,
  **F** favourites.
- **Phone:** tap a book once to open its card.
- Use the **category chips** (Fantasy, Romance…) to filter, or **Edit categories** to add or remove your own.
- **Continue reading** shows books you've started; tap **×** to hide one from that row.
- The **pinboard** on the side ("pin your mood") holds your quotes and notes. Tap **+** to add one.

### Reading
- **Turn pages:** tap or click the right or left edge, swipe, or use the arrow keys.
- **Jump somewhere:** tap the page label ("Page 42 of 310"). Type a page number, or pick a chapter (EPUBs).
- **Highlight:** select some text and pick a colour. Use the eraser to remove highlights.
- **Sticky notes and bookmarks** are in the toolbar. On a phone, tap the round purple button for the tools.
- **Text** lets you change the font, size and line spacing (EPUBs). **Zoom** fits PDFs to the page or width.
- **My notes** lists every highlight, note and bookmark in the book.
- Tap the middle of the page to hide or show the toolbar. Use the ← arrow at the top left to go back to the shelf.

### Sounds, backups and locking
- The **speaker** icon turns page and click sounds on or off and sets the volume.
- The **☰ menu** has **Export a backup** (saves your whole library to a file) and **Restore from backup…**.
- The **lock** icon closes the diary again.

---

## 3. Optional settings (sync, PIN and Google Books)

Copy `.env.example` to a new file called **`.env.local`** in the same folder, fill in what you want, then
restart `npm run dev`.

| Setting | What it does |
| --- | --- |
| `VITE_SUPABASE_URL`, `VITE_SUPABASE_ANON_KEY` | Turns on the 4-digit PIN and syncs your library across devices. Free [Supabase](https://supabase.com) project: see `SETUP.md` |
| `VITE_LIBRARY_EMAIL` | The account email the PIN signs in to. "Forgot PIN?" emails go here |
| `VITE_GOOGLE_BOOKS_KEY` | Adds Google Books to the free-book search. Free key from Google Cloud: see `SETUP.md` |

⚠️ `.env.local` is never uploaded to GitHub (it's in `.gitignore`). Never put real keys anywhere else, and never
use Supabase's `service_role` / secret key in this app.

---

## 4. Put it online (optional)

The easiest free host is **Vercel**. Full steps are in [`SETUP.md`](SETUP.md); in short:

1. Sign up at https://vercel.com with your GitHub account.
2. **Add New → Project** → import this repository → **Deploy** (it detects Vite automatically).
3. If you use the optional settings, add the same values under **Settings → Environment Variables**,
   then redeploy.

The `api/` folder is a small built-in backend (book downloads and open-access search) that Vercel runs for you.

---

## Troubleshooting

- **`npm` is not recognised:** install Node.js (step 1), then close and reopen the terminal.
- **Port 5173 is busy:** run `npm run dev -- --port 5180` and open http://localhost:5180.
- **A free book won't download:** some sources are slow or temporarily down. Tap **Try again**, or try
  another edition from the list.
- **Lost your books after clearing the browser:** without sync, books live only in that browser. Use
  **☰ → Export a backup** now and then to keep a copy.

---

Built with Vite, React 19 and TypeScript · pdf.js and epub.js for reading · Dexie (IndexedDB) for storage · Supabase for sync.
