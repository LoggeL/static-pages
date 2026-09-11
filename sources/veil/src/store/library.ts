import { create } from 'zustand'
import { get, set, del } from 'idb-keyval'
import type { CensorStyle } from '@/lib/types'

export interface LibraryItem {
  id: string
  name: string
  at: number
  faces: number
  credits: number
  width: number
  height: number
  style: CensorStyle
  presetId: string
}

const INDEX_KEY = 'veil.library.v1'
const thumbKey = (id: string) => `veil.thumb.${id}`

interface LibraryState {
  items: LibraryItem[]
  /** Object URLs for the stored thumbnails, keyed by item id. Session-scoped. */
  thumbs: Record<string, string>
  ready: boolean
  error: string | null
  hydrate: () => Promise<void>
  add: (item: LibraryItem, thumbnail: Blob) => Promise<void>
  remove: (id: string) => Promise<void>
  clear: () => Promise<void>
}

export const useLibrary = create<LibraryState>((set_, get_) => ({
  items: [],
  thumbs: {},
  ready: false,
  error: null,

  hydrate: async () => {
    try {
      const stored = (await get<LibraryItem[]>(INDEX_KEY)) ?? []
      const items = [...stored].sort((a, b) => b.at - a.at)
      const thumbs: Record<string, string> = {}
      await Promise.all(
        items.map(async (item) => {
          const blob = await get<Blob>(thumbKey(item.id))
          if (blob) thumbs[item.id] = URL.createObjectURL(blob)
        }),
      )
      set_({ items, thumbs, ready: true, error: null })
    } catch (error) {
      set_({ ready: true, error: error instanceof Error ? error.message : 'Local storage is unavailable, so the library is empty.' })
    }
  },

  add: async (item, thumbnail) => {
    const items = [item, ...get_().items]
    const url = URL.createObjectURL(thumbnail)
    set_({ items, thumbs: { ...get_().thumbs, [item.id]: url } })
    try {
      await set(INDEX_KEY, items)
      await set(thumbKey(item.id), thumbnail)
    } catch (error) {
      set_({ error: error instanceof Error ? error.message : 'Could not persist this export locally.' })
    }
  },

  remove: async (id) => {
    const url = get_().thumbs[id]
    if (url) URL.revokeObjectURL(url)
    const thumbs = { ...get_().thumbs }
    delete thumbs[id]
    const items = get_().items.filter((entry) => entry.id !== id)
    set_({ items, thumbs })
    await Promise.all([set(INDEX_KEY, items), del(thumbKey(id))])
  },

  clear: async () => {
    const { items, thumbs } = get_()
    Object.values(thumbs).forEach((url) => URL.revokeObjectURL(url))
    set_({ items: [], thumbs: {} })
    await Promise.all([set(INDEX_KEY, []), ...items.map((item) => del(thumbKey(item.id)))])
  },
}))
