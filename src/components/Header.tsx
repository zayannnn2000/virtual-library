import { useEffect, useRef, useState } from 'react'
import { exportBackup, importBackup, onSaveState, type SaveState } from '../db'
import { SLOGAN_LIST, firstSlogan } from '../lib/slogans'
import { Icon } from './Art'
import { useToast } from './ui'
import { canSignIn, onSyncState, runSync, setGuest, signOut, syncEnabled, type SyncState } from '../sync'
import { onSoundChange, setSoundOn, setSoundVolume, sfx, soundOn, soundVolume } from '../lib/sound'
import { ChangePinDialog } from './PinGate'

export function Header({ onAdd, onLock, occasion }: { onAdd: () => void; onLock: () => void; occasion?: string }) {
  return (
    <header className="site-header">
      <div className="brand">
        <h1 className="brand-title">
          Virtual <em>Library</em>
        </h1>
        <SloganRotator occasion={occasion} />
      </div>
      <div className="header-actions">
        <SaveStatus />
        <button
          className="icon-btn lock-btn"
          onClick={onLock}
          aria-label={syncEnabled ? 'Lock the library' : 'Open the diary again'}
          title={syncEnabled ? 'Lock the library — your PIN opens it again' : 'Open the diary again'}
        >
          <Icon name="lock" />
        </button>
        <SoundButton />
        <BackupMenu />
        <button className="btn add-btn" onClick={onAdd} aria-label="Add book">
          <Icon name="plus" size={18} /> <span>Add book</span>
        </button>
      </div>
    </header>
  )
}

/** A speaker button that opens a little sounds panel: on/off, and how loud. */
function SoundButton() {
  const [open, setOpen] = useState(false)
  const [on, setOn] = useState(soundOn)
  const [volume, setVolume] = useState(soundVolume)
  const ref = useRef<HTMLDivElement>(null)
  useEffect(() => onSoundChange(setOn), [])
  useEffect(() => {
    if (!open) return
    const onDoc = (e: PointerEvent) => !ref.current?.contains(e.target as Node) && setOpen(false)
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && setOpen(false)
    document.addEventListener('pointerdown', onDoc)
    document.addEventListener('keydown', onKey)
    return () => {
      document.removeEventListener('pointerdown', onDoc)
      document.removeEventListener('keydown', onKey)
    }
  }, [open])
  return (
    <div className="menu-wrap sound-wrap" ref={ref}>
      <button
        className={`icon-btn ${on ? '' : 'muted'}`}
        aria-label={on ? 'Sounds (on)' : 'Sounds (off)'}
        aria-expanded={open}
        title="Sounds"
        onClick={() => setOpen(!open)}
      >
        <Icon name={on ? 'sound' : 'soundOff'} />
      </button>
      {open && (
        <div className="menu sound-panel" role="dialog" aria-label="Sounds">
          <button role="switch" aria-checked={on} className="menu-sound" onClick={() => setSoundOn(!on)}>
            <span>
              <strong>Sounds</strong>
              <span className="fine">Page turns, the diary lock, glitter</span>
            </span>
            <span className={`toggle ${on ? 'on' : ''}`} aria-hidden>
              <span />
            </span>
          </button>
          <label className={`volume-row ${on ? '' : 'disabled'}`}>
            <Icon name="soundOff" size={16} />
            <span className="sr-only">Volume</span>
            <input
              type="range"
              min={0}
              max={1}
              step={0.05}
              value={volume}
              disabled={!on}
              onChange={(e) => {
                setVolume(+e.target.value)
                setSoundVolume(+e.target.value)
              }}
              // a little sparkle when she lets go, so she can hear the new level
              onPointerUp={() => sfx.sparkle()}
              onKeyUp={() => sfx.sparkle()}
            />
            <Icon name="sound" size={16} />
          </label>
          <button className="link-btn sound-test" disabled={!on} onClick={() => sfx.pageTurn()}>
            Play a page turn
          </button>
        </div>
      )}
    </div>
  )
}

/** The slogans take turns every 15 s; an occasion slogan (favorites, romance, a new book) steps in while it applies. */
function SloganRotator({ occasion }: { occasion?: string }) {
  const [i, setI] = useState(firstSlogan)
  useEffect(() => {
    if (occasion) return
    const t = window.setInterval(() => !document.hidden && setI((x) => (x + 1) % SLOGAN_LIST.length), 15000)
    return () => window.clearInterval(t)
  }, [occasion])
  const text = occasion ?? SLOGAN_LIST[i]
  return (
    <p className="slogan" key={text} aria-live="off">
      — {text}
    </p>
  )
}

function SaveStatus() {
  return syncEnabled ? <CloudStatus /> : <LocalStatus />
}

function CloudStatus() {
  const [state, setState] = useState<SyncState>('idle')
  const [detail, setDetail] = useState<string>()
  const [local, setLocal] = useState<SaveState>('idle')
  const toast = useToast()
  useEffect(() => onSyncState((s, d) => (setState(s), setDetail(d))), [])
  useEffect(
    () =>
      onSaveState((s, m) => {
        setLocal(s)
        if (s === 'error') toast({ message: m ?? "Couldn't save.", tone: 'error' })
      }),
    [toast],
  )
  const text =
    local === 'error' ? 'Not saved'
      : state === 'syncing' || local === 'saving' ? 'Syncing…'
      : state === 'synced' ? 'Synced'
      : state === 'offline' ? 'Offline · saved here, will sync'
      : state === 'error' ? 'Sync paused · saved here'
      : 'Saved'
  const tone = local === 'error' || state === 'error' ? 'error' : state === 'syncing' || local === 'saving' ? 'saving' : 'saved'
  return (
    <button
      className={`save-pill ${tone}`}
      title={state === 'error' ? `Sync problem: ${detail ?? 'unknown'}. Tap to retry.` : 'Your library is saved here and synced to your account.'}
      onClick={() => runSync().catch(() => {})}
    >
      <span className="dot" /> {text}
    </button>
  )
}

function LocalStatus() {
  const [state, setState] = useState<SaveState>('idle')
  const [msg, setMsg] = useState<string>()
  const [online, setOnline] = useState(navigator.onLine)
  const toast = useToast()
  useEffect(() => {
    let t: number
    const off = onSaveState((s, m) => {
      window.clearTimeout(t)
      setState(s)
      setMsg(m)
      if (s === 'error') toast({ message: m ?? "Couldn't save.", tone: 'error' })
      if (s === 'saved') t = window.setTimeout(() => setState('idle'), 2400)
    })
    const on = () => setOnline(true)
    const offl = () => setOnline(false)
    window.addEventListener('online', on)
    window.addEventListener('offline', offl)
    return () => {
      off()
      window.removeEventListener('online', on)
      window.removeEventListener('offline', offl)
    }
  }, [toast])
  const text =
    state === 'saving' ? 'Saving…' : state === 'saved' ? 'Saved' : state === 'error' ? 'Not saved' : online ? 'Saved on this device' : 'Offline · saved on this device'
  // Looking around without her PIN: say plainly that nothing syncs, and make it one tap to sign in.
  if (canSignIn && state !== 'saving' && state !== 'error') {
    return (
      <button
        className="save-pill local-only"
        title="This device isn't syncing. Tap to sign in with your PIN, and your books, files and notes follow you to every device."
        onClick={() => {
          setGuest(false)
          location.reload()
        }}
      >
        <span className="dot" /> <span className="pill-long">This device only · </span><u>Sign in to sync</u>
      </button>
    )
  }
  return (
    <span className={`save-pill ${state}`} role="status" title={msg ?? 'Everything is stored in this browser. Export a backup from the menu.'}>
      <span className="dot" /> {text}
    </span>
  )
}

function BackupMenu() {
  const [open, setOpen] = useState(false)
  const [changingPin, setChangingPin] = useState(false)
  const input = useRef<HTMLInputElement>(null)
  const ref = useRef<HTMLDivElement>(null)
  const toast = useToast()
  useEffect(() => {
    if (!open) return
    const onDoc = (e: MouseEvent) => !ref.current?.contains(e.target as Node) && setOpen(false)
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && setOpen(false)
    document.addEventListener('mousedown', onDoc)
    document.addEventListener('keydown', onKey)
    return () => {
      document.removeEventListener('mousedown', onDoc)
      document.removeEventListener('keydown', onKey)
    }
  }, [open])

  const doExport = async () => {
    setOpen(false)
    const blob = await exportBackup()
    const a = document.createElement('a')
    a.href = URL.createObjectURL(blob)
    a.download = `virtual-library-backup-${new Date().toISOString().slice(0, 10)}.json`
    a.click()
    URL.revokeObjectURL(a.href)
    toast({ message: 'Backup downloaded. Keep it with your ebook files.' })
  }

  return (
    <div className="menu-wrap" ref={ref}>
      <button className="icon-btn" aria-label="Library menu" aria-expanded={open} onClick={() => setOpen(!open)}>
        <Icon name="menu" />
      </button>
      {open && (
        <div className="menu" role="menu">
          <button role="menuitem" onClick={doExport}>Export a backup</button>
          <button role="menuitem" onClick={() => input.current?.click()}>Restore from backup…</button>
          <p className="fine menu-note">Backups hold the shelf, progress, bookmarks, highlights and notes — not the ebook files.</p>
          {syncEnabled && (
            <button
              role="menuitem"
              onClick={() => {
                setOpen(false)
                setChangingPin(true)
              }}
            >
              Change PIN
            </button>
          )}
          {syncEnabled && (
            <button
              role="menuitem"
              onClick={() => {
                setOpen(false)
                if (confirm('Sign out of this device? Your library stays safe in your account, and this device forgets its copy.')) signOut()
              }}
            >
              Sign out of this device
            </button>
          )}
          {!syncEnabled && canSignIn && (
            <button
              role="menuitem"
              onClick={() => {
                setGuest(false)
                location.reload()
              }}
            >
              Sign in to sync across devices
            </button>
          )}
        </div>
      )}
      <input
        ref={input}
        type="file"
        accept="application/json,.json"
        hidden
        onChange={async (e) => {
          const f = e.target.files?.[0]
          e.target.value = ''
          setOpen(false)
          if (!f) return
          try {
            const r = await importBackup(f)
            toast({ message: `Restored ${r.books} books and ${r.annotations} annotations.` })
          } catch (err) {
            toast({ message: (err as Error).message, tone: 'error' })
          }
        }}
      />
      {changingPin && <ChangePinDialog onClose={() => setChangingPin(false)} />}
    </div>
  )
}
