import { assetUrl } from './assets'

export interface SamplePhoto {
  id: string
  /** Path under `public/`, resolved against the app base at use time. */
  file: string
  label: string
  blurb: string
}

/** Bundled demo photography (Unsplash licence) so the studio works offline.
    Every one of these is verified to detect cleanly at the default sensitivity. */
export const SAMPLE_PHOTOS: SamplePhoto[] = [
  { id: 'portrait-man', file: 'samples/portrait-man.jpg', label: 'Portrait', blurb: '1 face · single subject' },
  { id: 'portrait-woman', file: 'samples/portrait-woman.jpg', label: 'Studio', blurb: '1 face · studio light' },
  { id: 'portrait-three-quarter', file: 'samples/portrait-three-quarter.jpg', label: 'Three-quarter', blurb: '1 face · shallow depth' },
  { id: 'group-collab', file: 'samples/group-collab.jpg', label: 'Duo', blurb: '2 faces · at the desk' },
  { id: 'group-studio', file: 'samples/group-studio.jpg', label: 'Table', blurb: '3 faces · cafe table' },
  { id: 'group-workshop', file: 'samples/group-workshop.jpg', label: 'Workshop', blurb: '3 faces · bookshelves' },
]

export async function fetchSampleFile(sample: SamplePhoto): Promise<File> {
  const response = await fetch(assetUrl(sample.file))
  if (!response.ok) throw new Error(`Could not load the ${sample.label} sample.`)
  const blob = await response.blob()
  return new File([blob], `${sample.id}.jpg`, { type: blob.type || 'image/jpeg' })
}
