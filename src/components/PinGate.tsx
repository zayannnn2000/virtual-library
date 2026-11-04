import { useCallback, useEffect, useState } from 'react'
import { changePin, createPin, sendPinReset, setGuest, signInWithPin } from '../sync'

/** The test site on this computer / home network gets a PIN-free preview; the live site never does. */
const isTestSite = /^(localhost|127\.|10\.|192\.168\.|172\.(1[6-9]|2\d|3[01])\.)/.test(location.hostname)
import {
  PIN_LENGTH,
  checkVerifier,
  emailIsFixed,
  isValidPin,
  libraryEmail,
  lockAgain,
  markUnlocked,
  rememberEmail,
  saveVerifier,
} from '../lib/pin'
import { Icon } from './Art'
import { Dialog, useToast } from './ui'
import { sfx } from '../lib/sound'

/* ---------- keypad ---------- */

function PinPad({ label, onComplete, busy, error }: { label: string; onComplete: (pin: string) => void; busy?: boolean; error?: string }) {
  const [pin, setPin] = useState('')
  const [shake, setShake] = useState(false)

  useEffect(() => {
    if (!error) return
    setPin('')
    setShake(true)
    const t = window.setTimeout(() => setShake(false), 450)
    return () => window.clearTimeout(t)
  }, [error])

  const press = useCallback(
    (d: string) => {
      if (busy) return
      sfx.tap()
      setPin((p) => {
        if (p.length >= PIN_LENGTH) return p
        const next = p + d
        if (next.length === PIN_LENGTH) window.setTimeout(() => onComplete(next), 120)
        return next
      })
    },
    [busy, onComplete],
  )
  const del = useCallback(() => !busy && setPin((p) => p.slice(0, -1)), [busy])

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.target as HTMLElement).closest('input, textarea')) return
      if (/^\d$/.test(e.key)) press(e.key)
      else if (e.key === 'Backspace') del()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [press, del])

  // A new prompt (e.g. "confirm your PIN") starts empty.
  useEffect(() => setPin(''), [label])

  return (
    <div className="pinpad">
      <p className="pin-label" id="pin-label">{label}</p>
      <div className={`pin-dots ${shake ? 'shake' : ''}`} role="img" aria-label={`${pin.length} of ${PIN_LENGTH} digits entered`}>
        {Array.from({ length: PIN_LENGTH }).map((_, i) => (
          <span key={i} className={i < pin.length ? 'filled' : ''} />
        ))}
      </div>
      <p className="pin-error" role="alert">{error ?? ' '}</p>
      <div className="pin-keys" role="group" aria-labelledby="pin-label">
        {['1', '2', '3', '4', '5', '6', '7', '8', '9'].map((d) => (
          <button key={d} type="button" onClick={() => press(d)} disabled={busy}>{d}</button>
        ))}
        <span />
        <button type="button" onClick={() => press('0')} disabled={busy}>0</button>
        <button type="button" onClick={del} disabled={busy} aria-label="Delete last digit"><Icon name="chevL" size={20} /></button>
      </div>
    </div>
  )
}

/** Mark the tab unlocked before signing in (the sign-in event fires mid-call), and undo it if the PIN is wrong. */
async function unlockWithServer(email: string, pin: string) {
  markUnlocked()
  try {
    await signInWithPin(email, pin)
  } catch (err) {
    lockAgain()
    throw err
  }
  await saveVerifier(pin)
}

/* ---------- the gate ---------- */

type Mode = 'enter' | 'lock' | 'create' | 'confirm' | 'forgot' | 'check-email' | 'recovery' | 'recovery-confirm'

/** The PIN keypad and its first-time / forgot / reset flows, shown under the diary. */
export function PinPanel({ initial, onUnlocked }: { initial: 'enter' | 'lock' | 'recovery'; onUnlocked: () => void }) {
  const [mode, setMode] = useState<Mode>(initial)
  const [email, setEmail] = useState(libraryEmail() ?? '')
  const [firstPin, setFirstPin] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string>()
  const [note, setNote] = useState<string>()
  const needEmail = !emailIsFixed() && (mode === 'enter' || mode === 'create' || mode === 'forgot')
  const emailOk = /\S+@\S+\.\S+/.test(email)

  const go = (m: Mode, n?: string) => {
    setMode(m)
    setError(undefined)
    setNote(n)
  }

  const run = async (fn: () => Promise<void>) => {
    setBusy(true)
    setError(undefined)
    try {
      await fn()
    } catch (err) {
      sfx.nope()
      setError((err as Error).message)
    } finally {
      setBusy(false)
    }
  }

  const onPin = (pin: string) => {
    if (!isValidPin(pin)) return
    if (mode === 'lock') {
      return run(async () => {
        if (await checkVerifier(pin)) {
          markUnlocked()
          return onUnlocked()
        }
        // The PIN may have been changed on another device — ask the server.
        const e = libraryEmail()
        if (e && navigator.onLine) {
          await unlockWithServer(e, pin)
          return onUnlocked()
        }
        throw new Error("That PIN isn't right.")
      })
    }
    if (mode === 'enter') {
      return run(async () => {
        rememberEmail(email)
        await unlockWithServer(email, pin)
        onUnlocked()
      })
    }
    if (mode === 'create' || mode === 'recovery') {
      setFirstPin(pin)
      return go(mode === 'create' ? 'confirm' : 'recovery-confirm')
    }
    if (mode === 'confirm' || mode === 'recovery-confirm') {
      if (pin !== firstPin) {
        setFirstPin('')
        setMode(mode === 'confirm' ? 'create' : 'recovery')
        sfx.nope()
        return setError("Those didn't match — let's try again.")
      }
      return run(async () => {
        if (mode === 'recovery-confirm') {
          await changePin(pin)
        } else {
          rememberEmail(email)
          const result = await createPin(email, pin)
          if (result === 'exists') return go('enter', 'This library already has a PIN — enter it, or use “Forgot PIN?”.')
          if (result === 'check-email') {
            await saveVerifier(pin)
            return go('check-email', `We sent an activation email to ${email}. Open it on this device, and your PIN is ready.`)
          }
        }
        await saveVerifier(pin)
        markUnlocked()
        onUnlocked()
      })
    }
  }

  const titles: Record<Mode, string> = {
    enter: 'Enter your PIN',
    lock: 'Enter your PIN',
    create: `Choose a ${PIN_LENGTH}-digit PIN`,
    confirm: 'Type it once more',
    forgot: 'Forgot your PIN?',
    'check-email': 'Check your inbox',
    recovery: `Choose a new ${PIN_LENGTH}-digit PIN`,
    'recovery-confirm': 'Type it once more',
  }
  const showPad = mode !== 'forgot' && mode !== 'check-email' && (!needEmail || emailOk)

  return (
    <div className="pin-panel" role="dialog" aria-label="Unlock the library">
      <div className="pin-card">
        {note && <p className="pin-note" role="status">{note}</p>}

        {needEmail && (
          <label className="field">
            <span>Your email {mode === 'enter' ? '(just the first time on this device)' : ''}</span>
            <input className="input" type="email" autoComplete="email" inputMode="email" value={email} onChange={(e) => setEmail(e.target.value)} />
          </label>
        )}

        {showPad && <PinPad label={titles[mode]} onComplete={onPin} busy={busy} error={error} />}

        {mode === 'forgot' && (
          <div className="pin-forgot">
            <p>We'll email {emailIsFixed() ? 'you' : 'the address above'} a link to choose a new PIN. Your books and notes stay exactly as they are.</p>
            <button
              className="btn"
              disabled={busy || !emailOk}
              onClick={() => run(async () => {
                await sendPinReset(email)
                go('check-email', `A reset link is on its way to ${email}. Open it on this device to choose a new PIN.`)
              })}
            >
              {busy ? 'Sending…' : 'Send me a reset link'}
            </button>
            {error && <p className="pin-error" role="alert">{error}</p>}
          </div>
        )}

        {mode === 'check-email' && <p className="fine">You can close this tab once you've opened the link.</p>}

        <div className="pin-links">
          {(mode === 'enter' || mode === 'lock') && (
            <button className="link-btn" onClick={() => go('forgot')}>Forgot PIN?</button>
          )}
          {mode === 'enter' && <button className="link-btn" onClick={() => go('create')}>First time here? Set your PIN</button>}
          {(mode === 'create' || mode === 'confirm' || mode === 'forgot' || mode === 'check-email') && (
            <button className="link-btn" onClick={() => go(initial === 'lock' ? 'lock' : 'enter')}>I already have a PIN</button>
          )}
          {isTestSite && (mode === 'enter' || mode === 'create') && (
            <button className="link-btn quiet" onClick={() => { setGuest(true); location.reload() }}>
              Preview without a PIN — test site only, saved on this device
            </button>
          )}
        </div>
      </div>
    </div>
  )
}

/* ---------- change PIN from the menu ---------- */

export function ChangePinDialog({ onClose }: { onClose: () => void }) {
  const toast = useToast()
  const [first, setFirst] = useState<string>()
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string>()
  const onPin = async (pin: string) => {
    if (!first) {
      setError(undefined)
      return setFirst(pin)
    }
    if (pin !== first) {
      setFirst(undefined)
      return setError("Those didn't match — let's try again.")
    }
    setBusy(true)
    try {
      await changePin(pin)
      await saveVerifier(pin)
      toast({ message: 'Your new PIN is set.' })
      onClose()
    } catch (err) {
      setFirst(undefined)
      setError((err as Error).message)
    } finally {
      setBusy(false)
    }
  }
  return (
    <Dialog label="Change PIN" onClose={onClose} className="pin-dialog">
      <header className="dialog-head">
        <p className="eyebrow">Change PIN</p>
      </header>
      <PinPad label={first ? 'Type it once more' : `Choose a new ${PIN_LENGTH}-digit PIN`} onComplete={onPin} busy={busy} error={error} />
    </Dialog>
  )
}
