/**
 * Her own pictures on the pinboard. The list (frame, order) lives in a synced
 * setting; each picture is a blob, so it syncs like covers do.
 */
import { useEffect, useState } from 'react'
import { useLiveQuery } from 'dexie-react-hooks'
import { canFetchRemote, db, downloadBlob, save, uid } from '../db'

export type Frame = 'polaroid' | 'gold' | 'tape' | 'scallop'
export const FRAMES: { frame: Frame; name: string }[] = [
  { frame: 'polaroid', name: 'Polaroid' },
  { frame: 'gold', name: 'Gold frame' },
  { frame: 'tape', name: 'Washi tape' },
  { frame: 'scallop', name: 'Scalloped lace' },
]

export interface BoardPhoto {
  id: string
  frame: Frame
  tilt: number
  addedAt: number
}

const KEY = 'boardPhotos'
const blobKey = (id: string) => `board-${id}:photo`

export function useBoardPhotos() {
  return useLiveQuery(async () => ((await db.settings.get(KEY))?.value as BoardPhoto[] | undefined) ?? [], []) ?? []
}

export function usePhotoUrl(id: string) {
  return useBlobUrl(`board-${id}`)
}

/** An object URL for a picture blob; brings it down from her cloud library if this device doesn't have it yet. */
function useBlobUrl(owner: string) {
  const blob = useLiveQuery(async () => (await db.blobs.get(`${owner}:photo`))?.blob ?? null, [owner])
  const [url, setUrl] = useState<string>()
  useEffect(() => {
    if (blob === null && canFetchRemote()) downloadBlob(owner, 'photo').catch(() => {})
  }, [blob, owner])
  useEffect(() => {
    if (!blob) return setUrl(undefined)
    const u = URL.createObjectURL(blob)
    setUrl(u)
    return () => URL.revokeObjectURL(u)
  }, [blob])
  return url
}

/** Shrink a picture so the board stays light (max 900px, JPEG). */
async function shrink(file: Blob, max = 900, type = 'image/jpeg'): Promise<Blob> {
  const bmp = await createImageBitmap(file)
  const scale = Math.min(1, max / Math.max(bmp.width, bmp.height))
  const c = document.createElement('canvas')
  c.width = Math.round(bmp.width * scale)
  c.height = Math.round(bmp.height * scale)
  c.getContext('2d')!.drawImage(bmp, 0, 0, c.width, c.height)
  bmp.close()
  return new Promise((resolve, reject) => c.toBlob((b) => (b ? resolve(b) : reject(new Error('Could not read that image.'))), type, 0.86))
}


export async function addBoardPhotos(files: Blob[], frame: Frame) {
  const images = files.filter((f) => f.type.startsWith('image/'))
  if (!images.length) throw new Error('That isn’t a picture — try a JPG, PNG or WebP.')
  const added: BoardPhoto[] = []
  for (const f of images) {
    const blob = await shrink(f)
    const id = uid()
    await save(() => db.blobs.put({ key: blobKey(id), bookId: `board-${id}`, blob }))
    added.push({ id, frame, tilt: Math.round((Math.random() * 10 - 5) * 10) / 10, addedAt: Date.now() })
  }
  const current = ((await db.settings.get(KEY))?.value as BoardPhoto[] | undefined) ?? []
  await save(() => db.settings.put({ key: KEY, value: [...added, ...current] }))
  return added.length
}

export async function removeBoardPhoto(id: string) {
  const current = ((await db.settings.get(KEY))?.value as BoardPhoto[] | undefined) ?? []
  await save(() =>
    db.transaction('rw', db.settings, db.blobs, async () => {
      await db.settings.put({ key: KEY, value: current.filter((p) => p.id !== id) })
      await db.blobs.delete(blobKey(id))
    }),
  )
}

export async function restoreBoardPhoto(photo: BoardPhoto, blob: Blob) {
  const current = ((await db.settings.get(KEY))?.value as BoardPhoto[] | undefined) ?? []
  await save(() =>
    db.transaction('rw', db.settings, db.blobs, async () => {
      await db.blobs.put({ key: blobKey(photo.id), bookId: `board-${photo.id}`, blob })
      await db.settings.put({ key: KEY, value: [photo, ...current] })
    }),
  )
}

export async function getPhotoBlob(id: string) {
  return (await db.blobs.get(blobKey(id)))?.blob
}
