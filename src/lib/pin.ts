/**
 * The PIN is her Supabase password. A salted PBKDF2 hash of it is also kept on
 * each device so the lock screen can unlock instantly — and offline — on every
 * new visit, without sending the PIN anywhere.
 */
// ("pin4": a device that remembered an older 6-digit PIN just asks for the PIN again.)
const VERIFIER = 'library:pin4'
const UNLOCKED = 'library:unlocked'
const EMAIL = 'library:email'

export const PIN_LENGTH = 4
export const isValidPin = (p: string) => new RegExp(`^\\d{${PIN_LENGTH}}$`).test(p)

/**
 * Supabase needs passwords of 6+ characters, so her 4-digit PIN is stretched into one
 * with a fixed suffix. She only ever types the 4 digits.
 */
export const pinPassword = (pin: string) => `${pin}·virtual-library`

/** Her email: set at build time (VITE_LIBRARY_EMAIL) or remembered from the first sign-in on this device. */
export function libraryEmail(): string | undefined {
  const fixed = (import.meta.env.VITE_LIBRARY_EMAIL as string | undefined)?.replace(/^﻿/, '').trim()
  if (fixed) return fixed
  try {
    return localStorage.getItem(EMAIL) ?? undefined
  } catch {
    return undefined
  }
}
export const emailIsFixed = () => !!(import.meta.env.VITE_LIBRARY_EMAIL as string | undefined)?.trim()
export function rememberEmail(email: string) {
  try {
    localStorage.setItem(EMAIL, email.trim())
  } catch {
    /* fine */
  }
}

const enc = new TextEncoder()
const toHex = (b: ArrayBuffer) => [...new Uint8Array(b)].map((x) => x.toString(16).padStart(2, '0')).join('')
const fromHex = (h: string) => new Uint8Array(h.match(/../g)!.map((x) => parseInt(x, 16)))

async function derive(pin: string, salt: Uint8Array) {
  const key = await crypto.subtle.importKey('raw', enc.encode(pin), 'PBKDF2', false, ['deriveBits'])
  return toHex(await crypto.subtle.deriveBits({ name: 'PBKDF2', hash: 'SHA-256', salt, iterations: 210_000 }, key, 256))
}

export async function saveVerifier(pin: string) {
  const salt = crypto.getRandomValues(new Uint8Array(16))
  const hash = await derive(pin, salt)
  try {
    localStorage.setItem(VERIFIER, `${toHex(salt.buffer)}:${hash}`)
  } catch {
    /* without storage the lock simply isn't shown */
  }
}

export async function checkVerifier(pin: string) {
  const stored = localStorage.getItem(VERIFIER)
  if (!stored) return false
  const [salt, hash] = stored.split(':')
  return (await derive(pin, fromHex(salt))) === hash
}

export function hasVerifier() {
  try {
    return !!localStorage.getItem(VERIFIER)
  } catch {
    return false
  }
}

/** Unlocked for this browser tab only — a fresh visit asks for the PIN again. */
export function markUnlocked() {
  try {
    sessionStorage.setItem(UNLOCKED, '1')
  } catch {
    /* fine */
  }
}
export function lockAgain() {
  try {
    sessionStorage.removeItem(UNLOCKED)
  } catch {
    /* fine */
  }
}
export function isUnlocked() {
  try {
    return sessionStorage.getItem(UNLOCKED) === '1'
  } catch {
    return true
  }
}
export const needsLock = () => hasVerifier() && !isUnlocked()

export function forgetPinOnThisDevice() {
  try {
    localStorage.removeItem(VERIFIER)
    sessionStorage.removeItem(UNLOCKED)
  } catch {
    /* fine */
  }
}
