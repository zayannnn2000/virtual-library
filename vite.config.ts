import { defineConfig, type Connect, type Plugin, type ProxyOptions } from 'vite'
import react from '@vitejs/plugin-react'
import { Readable } from 'node:stream'
import type { ReadableStream as NodeReadableStream } from 'node:stream/web'
import { handleFetchBook, handleOaSearch } from './server/books'

// The same small backend the live site runs as Vercel functions (/api/*), served
// by the dev and preview servers so the test site behaves exactly like the real one.
const api: Record<string, (req: Request) => Promise<Response>> = {
  '/api/fetch-book': handleFetchBook,
  '/api/oa-search': handleOaSearch,
}
const apiMiddleware: Connect.NextHandleFunction = async (req, res, next) => {
  const handler = api[(req.url ?? '').split('?')[0]]
  if (!handler || req.method !== 'GET') return next()
  try {
    const response = await handler(new Request(`http://${req.headers.host}${req.url}`))
    res.statusCode = response.status
    response.headers.forEach((v, k) => res.setHeader(k, v))
    if (!response.body) return res.end()
    const body = Readable.fromWeb(response.body as unknown as NodeReadableStream)
    req.on('close', () => body.destroy())
    body.on('error', () => res.destroy())
    body.pipe(res)
  } catch (err) {
    res.statusCode = 500
    res.end(JSON.stringify({ error: 'unavailable', message: (err as Error).message }))
  }
}
const bookApi: Plugin = {
  name: 'virtual-library-book-api',
  configureServer: (server) => void server.middlewares.use(apiMiddleware),
  configurePreviewServer: (server) => void server.middlewares.use(apiMiddleware),
}

// Project Gutenberg files don't allow cross-site downloads, so the app fetches them
// through its own address. Only book files and covers are passed through — the
// same rule as the rewrite in vercel.json.
const gutenberg: Record<string, ProxyOptions> = {
  '^/gutenberg/\\d+/pg\\d+(-images-3)?(\\.epub|\\.cover\\.medium\\.jpg)$': {
    target: 'https://www.gutenberg.org',
    changeOrigin: true,
    rewrite: (path) => path.replace(/^\/gutenberg\/(\d+)\//, '/cache/epub/$1/'),
  },
  '^/gutenberg-search(\\?|$)': {
    target: 'https://www.gutenberg.org',
    changeOrigin: true,
    rewrite: (path) => path.replace(/^\/gutenberg-search/, '/ebooks/search.opds/'),
  },
}

// https://vite.dev/config/
export default defineConfig({
  plugins: [react(), bookApi],
  server: { proxy: gutenberg },
  preview: { proxy: gutenberg },
})
