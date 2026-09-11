import { create } from 'zustand'
import { detectFaces, DetectorUnavailable, type DetectStage } from '@/lib/detect'
import { decodeFile, type DecodedImage } from '@/lib/imaging'
import { PRESETS, clamp, regionFromPreset, uid, type Box, type Region, type RegionSource } from '@/lib/types'

export interface LoadedPhoto {
  id: string
  name: string
  size: number
  image: DecodedImage
}

export type StudioTool = 'select' | 'draw'

interface StudioState {
  photo: LoadedPhoto | null
  regions: Region[]
  past: Region[][]
  future: Region[][]
  selectedId: string | null
  tool: StudioTool
  presetId: string
  sensitivity: number
  scanning: boolean
  decodeError: string | null
  detectError: string | null
  stage: DetectStage | null
  lastScan: { faces: number; at: number } | null
  /** Set by an external caller so another route can hand the studio a file. */
  inbox: File | null

  load: (file: File) => Promise<void>
  scan: () => Promise<void>
  close: () => void
  requeue: (file: File) => void
  takeQueued: () => File | null
  setTool: (tool: StudioTool) => void
  setPresetId: (id: string) => void
  setSensitivity: (value: number) => void
  select: (id: string | null) => void
  pushHistory: () => void
  addRegion: (box: Box, source?: RegionSource) => string | null
  updateRegion: (id: string, patch: Partial<Region>, options?: { history?: boolean }) => void
  removeRegion: (id: string) => void
  applyPresetToAll: (presetId: string) => void
  restyleSelected: (patch: Partial<Region>) => void
  clearRegions: () => void
  setRegions: (regions: Region[]) => void
  undo: () => void
  redo: () => void
}

const HISTORY_LIMIT = 40

function activePreset(id: string) {
  return PRESETS.find((preset) => preset.id === id) ?? PRESETS[0]
}

export const useStudio = create<StudioState>((set, get) => ({
  photo: null,
  regions: [],
  past: [],
  future: [],
  selectedId: null,
  tool: 'select',
  presetId: 'soft',
  sensitivity: 0.7,
  scanning: false,
  decodeError: null,
  detectError: null,
  stage: null,
  lastScan: null,
  inbox: null,

  load: async (file) => {
    set({ decodeError: null, detectError: null })
    try {
      const image = await decodeFile(file)
      set({
        photo: { id: uid(), name: file.name, size: file.size, image },
        regions: [],
        past: [],
        future: [],
        selectedId: null,
        lastScan: null,
        tool: 'select',
      })
    } catch (error) {
      set({ decodeError: error instanceof Error ? error.message : 'That file could not be read as an image.' })
    }
  },

  scan: async () => {
    const { photo, sensitivity, regions, presetId } = get()
    if (!photo || get().scanning) return
    set({ scanning: true, detectError: null, stage: null })
    try {
      const faces = await detectFaces(photo.image.source, photo.image.width, photo.image.height, {
        sensitivity,
        onStage: (stage) => set({ stage }),
      })
      const preset = activePreset(presetId)
      const detected = faces.map((face) => regionFromPreset(preset, face.box, 'auto', face.score, face.model))
      // Manual marks are deliberate; a re-scan only replaces its own output.
      const manual = regions.filter((region) => region.source === 'manual')
      get().pushHistory()
      set({
        regions: [...detected, ...manual],
        scanning: false,
        stage: null,
        selectedId: null,
        lastScan: { faces: detected.length, at: Date.now() },
      })
    } catch (error) {
      set({
        scanning: false,
        stage: null,
        detectError:
          error instanceof DetectorUnavailable
            ? 'The on-device detector could not start. Draw regions by hand — everything else still works, and nothing is uploaded.'
            : error instanceof Error
              ? error.message
              : 'The scan failed.',
      })
    }
  },

  close: () => set({ photo: null, regions: [], past: [], future: [], selectedId: null, lastScan: null, detectError: null, decodeError: null }),

  requeue: (file) => set({ inbox: file }),
  takeQueued: () => {
    const file = get().inbox
    if (file) set({ inbox: null })
    return file
  },

  setTool: (tool) => set({ tool }),
  setPresetId: (presetId) => set({ presetId }),
  setSensitivity: (sensitivity) => set({ sensitivity: clamp(sensitivity, 0, 1) }),
  select: (selectedId) => set({ selectedId }),

  pushHistory: () => {
    const { past, regions } = get()
    set({ past: [...past, regions].slice(-HISTORY_LIMIT), future: [] })
  },

  addRegion: (box, source = 'manual') => {
    if (box.w < 0.008 || box.h < 0.008) return null
    const preset = activePreset(get().presetId)
    const region = regionFromPreset(preset, box, source)
    get().pushHistory()
    set({ regions: [...get().regions, region], selectedId: region.id })
    return region.id
  },

  updateRegion: (id, patch, options = {}) => {
    if (options.history !== false) get().pushHistory()
    set({ regions: get().regions.map((region) => (region.id === id ? { ...region, ...patch } : region)) })
  },

  removeRegion: (id) => {
    get().pushHistory()
    set({ regions: get().regions.filter((region) => region.id !== id), selectedId: get().selectedId === id ? null : get().selectedId })
  },

  applyPresetToAll: (presetId) => {
    const preset = activePreset(presetId)
    get().pushHistory()
    set({
      presetId,
      regions: get().regions.map((region) => ({
        ...region,
        style: preset.style,
        shape: preset.shape,
        intensity: preset.intensity,
        feather: preset.feather,
        pad: preset.pad,
        emoji: preset.emoji,
      })),
    })
  },

  restyleSelected: (patch) => {
    const { selectedId } = get()
    if (!selectedId) return
    get().updateRegion(selectedId, patch)
  },

  clearRegions: () => {
    if (!get().regions.length) return
    get().pushHistory()
    set({ regions: [], selectedId: null })
  },

  setRegions: (regions) => set({ regions }),

  undo: () => {
    const { past, future, regions } = get()
    if (!past.length) return
    set({ regions: past[past.length - 1], past: past.slice(0, -1), future: [regions, ...future].slice(0, HISTORY_LIMIT), selectedId: null })
  },

  redo: () => {
    const { past, future, regions } = get()
    if (!future.length) return
    set({ regions: future[0], future: future.slice(1), past: [...past, regions].slice(-HISTORY_LIMIT), selectedId: null })
  },
}))
