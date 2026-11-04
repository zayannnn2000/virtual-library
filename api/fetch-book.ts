// Vercel function: GET /api/fetch-book?url=…[&check=1] — see server/books.ts.
import { handleFetchBook } from '../server/books.js'

export const config = { maxDuration: 60 }

export function GET(request: Request) {
  return handleFetchBook(request)
}
