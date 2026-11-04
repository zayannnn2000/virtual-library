import { db, getSetting } from '../db'
import type { Book } from '../types'
import { olCover } from './metadata'

/**
 * Her favourite series, already on the shelf on day one. Covers are the real
 * published covers from Open Library; no ebook files are attached. Each carries its spine colour\n * (measured from its cover), so her very first visit paints the shelf in its final colours.
 */
const SEED: { title: string; color: string; author: string; cover: number; pages: number; year: number; series: string; genres: string[]; work?: string }[] = [
  { title: 'Twisted Love', color: 'v2:hsl(210 39% 82%)', author: 'Ana Huang', cover: 12940491, pages: 358, year: 2021, series: 'Twisted', genres: ['Dark Romance', 'Romance'], work: '/works/OL24390422W' },
  { title: 'Twisted Games', color: 'v2:hsl(35 48% 78%)', author: 'Ana Huang', cover: 12821465, pages: 454, year: 2021, series: 'Twisted', genres: ['Dark Romance', 'Romance'], work: '/works/OL25515697W' },
  { title: 'Twisted Hate', color: 'v2:hsl(12 70% 84%)', author: 'Ana Huang', cover: 12928487, pages: 528, year: 2022, series: 'Twisted', genres: ['Dark Romance', 'Romance'] },
  { title: 'Twisted Lies', color: 'v2:hsl(134 29% 84%)', author: 'Ana Huang', cover: 14425197, pages: 616, year: 2022, series: 'Twisted', genres: ['Dark Romance', 'Romance'], work: '/works/OL27818823W' },
  { title: 'The Deal', color: 'v2:hsl(12 40% 59%)', author: 'Elle Kennedy', cover: 10201611, pages: 390, year: 2015, series: 'Off-Campus', genres: ['Romance'] },
  { title: 'The Mistake', color: 'v2:hsl(203 33% 72%)', author: 'Elle Kennedy', cover: 10420220, pages: 302, year: 2015, series: 'Off-Campus', genres: ['Romance'] },
  { title: 'The Score', color: 'v2:hsl(14 40% 63%)', author: 'Elle Kennedy', cover: 10538493, pages: 354, year: 2016, series: 'Off-Campus', genres: ['Romance'] },
  { title: 'The Goal', color: 'v2:hsl(348 36% 62%)', author: 'Elle Kennedy', cover: 12371614, pages: 383, year: 2016, series: 'Off-Campus', genres: ['Romance'] },
  { title: 'The Legacy', color: 'v2:hsl(10 32% 57%)', author: 'Elle Kennedy', cover: 12027045, pages: 317, year: 2021, series: 'Off-Campus', genres: ['Romance'] },
]

let seeding: Promise<void> | undefined
export function seedOnce() {
  seeding ??= seed()
  return seeding
}

async function seed() {
  if (await getSetting('seeded', false)) return
  const now = Date.now()
  const books: Book[] = SEED.map((s, i) => ({
    // The same id on every device, so her phone and laptop agree it's the same book.
    id: `seed-${s.title.toLowerCase().replace(/[^a-z0-9]+/g, '-')}`,
    title: s.title,
    authors: [s.author],
    year: s.year,
    pages: s.pages,
    olWorkKey: s.work,
    coverUrl: olCover(s.cover),
    coverSource: 'openlibrary',
    spineColor: s.color,
    genres: s.genres,
    // Her favourite series — already read and loved, so the landing shelf starts full.
    status: 'finished',
    favorite: false,
    addedAt: now - (SEED.length - i) * 1000,
    updatedAt: now,
  }))
  await db.transaction('rw', db.books, db.settings, async () => {
    if ((await db.settings.get('seeded'))?.value) return
    await db.books.bulkAdd(books)
    await db.settings.put({ key: 'seeded', value: true })
  })
}
