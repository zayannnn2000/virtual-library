import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import './styles/base.css'
import './styles/shelf.css'
import './styles/dialogs.css'
import './styles/diary.css'
import './styles/reader.css'
import App from './App.tsx'
import { ToastHost } from './components/ui'
import { warmAudio } from './lib/sound'

// After a new version is deployed, a tab opened earlier may ask for files that no longer
// exist (e.g. the reader). Reload once to pick up the new version instead of failing.
window.addEventListener('vite:preloadError', (e) => {
  e.preventDefault()
  reloadForNewVersion()
})

export function reloadForNewVersion() {
  try {
    const last = Number(sessionStorage.getItem('library:reloaded-at') ?? 0)
    if (Date.now() - last < 30_000) return false // already tried — don't loop
    sessionStorage.setItem('library:reloaded-at', String(Date.now()))
  } catch {
    /* storage blocked: still worth one reload */
  }
  location.reload()
  return true
}

// Wake the sound engine on her first touch (even a scroll), so it's ready before the first book opens.
window.addEventListener('pointerdown', () => warmAudio(), { once: true, passive: true, capture: true })

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <ToastHost>
      <App />
    </ToastHost>
  </StrictMode>,
)
