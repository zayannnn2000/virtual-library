/** The library's taglines. They take turns; a few step in when the moment fits. */
export const SLOGANS = {
  busy: 'Booked, busy, and ignoring everyone.',
  lateNight: 'One more chapter. Five hours ago.',
  favorites: 'Your shelf. Your rules. Your fictional boyfriends.',
  romance: 'Emotionally unavailable. Plot reasons.',
  bigShelf: 'A perfectly reasonable number of books. Don’t count.',
} as const

export const SLOGAN_LIST: string[] = Object.values(SLOGANS)

/**
 * A slogan that suits right now — or undefined, in which case they simply rotate.
 * (Late night only steps in on the first pick of a visit, so it doesn't take over.)
 */
export function occasionSlogan(ctx: { filter: string; justAdded?: boolean }) {
  if (ctx.justAdded) return SLOGANS.bigShelf
  if (ctx.filter === 'favorites') return SLOGANS.favorites
  if (ctx.filter === 'Romance' || ctx.filter === 'Dark Romance') return SLOGANS.romance
  return undefined
}

/** Where the rotation starts this visit: late at night it opens with the "five hours ago" one. */
export function firstSlogan() {
  const hour = new Date().getHours()
  if (hour >= 23 || hour < 5) return SLOGAN_LIST.indexOf(SLOGANS.lateNight)
  return Math.floor(Math.random() * SLOGAN_LIST.length)
}
