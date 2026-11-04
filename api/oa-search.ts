// Vercel function: GET /api/oa-search?source=oapen|doab&q=…&mode=… — see server/books.ts.
import { handleOaSearch } from '../server/books.js'

export function GET(request: Request) {
  return handleOaSearch(request)
}
