import { FaceDetector, FilesetResolver } from '@mediapipe/tasks-vision'
import type { FaceDetectorOptions, FaceDetectorResult } from '@mediapipe/tasks-vision'
import type { Box, Keypoint } from './types'
import { assetUrl } from './assets'

export type { Box, Keypoint }

export interface DetectedFace {
  /** Box already widened the way a redaction needs it (brow → chin, plus hair). */
  box: Box
  /** Tight model output, kept for diagnostics and the HUD readout. */
  raw: Box
  score: number
  keypoints: Keypoint[]
  model: 'close' | 'wide'
}

export type DetectStage = 'runtime' | 'models' | 'scan'

export interface DetectOptions {
  /** 0 = only obvious faces, 1 = accept weak detections. */
  sensitivity?: number
  onStage?: (stage: DetectStage) => void
}

/** Overlap ratio below which two boxes are considered the same face. */
const MERGE_IOU = 0.34

const KEYPOINT_LABELS: Keypoint['label'][] = ['eye', 'eye', 'nose', 'mouth', 'ear', 'ear']

/** Both BlazeFace variants the auto-scan runs in parallel. */
export interface FaceEngines {
  close: FaceDetector
  wide: FaceDetector
}

let runtime: FaceEngines | null = null
let booting: Promise<FaceEngines> | null = null

function detectorOptions(modelAssetPath: string, delegate: 'GPU' | 'CPU'): FaceDetectorOptions {
  return {
    baseOptions: { modelAssetPath, delegate },
    runningMode: 'IMAGE',
    // Deliberately permissive: sensitivity is applied as a score filter below so
    // the control is instant instead of rebuilding the graph on every change.
    minDetectionConfidence: 0.12,
    minSuppressionThreshold: 0.3,
  }
}

/** Loads the WASM runtime and both BlazeFace variants. Safe to call repeatedly. */
export function warm(options: { onStage?: (stage: DetectStage) => void } = {}): Promise<FaceEngines> {
  if (runtime) return Promise.resolve(runtime)
  if (booting) return booting
  const base = assetUrl('.')
  booting = (async () => {
    options.onStage?.('runtime')
    const fileset = await FilesetResolver.forVisionTasks(`${base}mediapipe/wasm`)
    options.onStage?.('models')
    // Some headless / software-GL environments cannot build a GPU delegate.
    let close: FaceDetector
    let wide: FaceDetector
    try {
      ;[close, wide] = await Promise.all([
        FaceDetector.createFromOptions(fileset, detectorOptions(`${base}models/blaze_face_short_range.tflite`, 'GPU')),
        FaceDetector.createFromOptions(fileset, detectorOptions(`${base}models/blaze_face_full_range.tflite`, 'GPU')),
      ])
    } catch {
      ;[close, wide] = await Promise.all([
        FaceDetector.createFromOptions(fileset, detectorOptions(`${base}models/blaze_face_short_range.tflite`, 'CPU')),
        FaceDetector.createFromOptions(fileset, detectorOptions(`${base}models/blaze_face_full_range.tflite`, 'CPU')),
      ])
    }
    runtime = { close, wide }
    return runtime
  })().catch((error) => {
    booting = null
    throw error
  })
  return booting
}

function iou(a: Box, b: Box): number {
  const x1 = Math.max(a.x, b.x)
  const y1 = Math.max(a.y, b.y)
  const x2 = Math.min(a.x + a.w, b.x + b.w)
  const y2 = Math.min(a.y + a.h, b.y + b.h)
  if (x2 <= x1 || y2 <= y1) return 0
  const inter = (x2 - x1) * (y2 - y1)
  return inter / (a.w * a.h + b.w * b.h - inter)
}

/**
 * BlazeFace boxes stop at the brow and jaw, which leaves hair and chin exposed.
 * Grow the box the way a redaction actually needs, biased upward for hairline.
 */
export function expandFaceBox(box: Box): Box {
  const growX = box.w * 0.24
  const growTop = box.h * 0.46
  const growBottom = box.h * 0.34
  const x = box.x - growX
  const y = box.y - growTop
  const w = box.w + growX * 2
  const h = box.h + growTop + growBottom
  const x2 = Math.min(1, x + w)
  const y2 = Math.min(1, y + h)
  return { x: Math.max(0, x), y: Math.max(0, y), w: x2 - Math.max(0, x), h: y2 - Math.max(0, y) }
}

function toBox(rect: { originX: number; originY: number; width: number; height: number }, w: number, h: number): Box {
  return { x: rect.originX / w, y: rect.originY / h, w: rect.width / w, h: rect.height / h }
}

/** MediaPipe returns two entries per eye (inner + outer), so collapse them.
    Its keypoint type is not exported by the package, hence the structural shape. */
function toKeypoints(points: readonly { x: number; y: number }[], w: number, h: number): Keypoint[] {
  return points.map((point, index) => ({
    x: point.x / w,
    y: point.y / h,
    label: KEYPOINT_LABELS[index] ?? 'nose',
  }))
}

function merge(detections: DetectedFace[]): DetectedFace[] {
  const sorted = [...detections].sort((a, b) => b.score - a.score)
  const kept: DetectedFace[] = []
  for (const candidate of sorted) {
    const duplicate = kept.find((k) => iou(k.raw, candidate.raw) > MERGE_IOU || iou(k.box, candidate.box) > MERGE_IOU)
    if (duplicate) {
      // Prefer the wider keypoint set / stronger score but keep whichever box better
      // frames the head: union of the two, so nothing peeks out.
      if (candidate.score > duplicate.score) {
        duplicate.score = candidate.score
        duplicate.model = candidate.model
      }
      duplicate.box = union(duplicate.box, candidate.box)
      continue
    }
    kept.push({ ...candidate, keypoints: [...candidate.keypoints] })
  }
  return kept
}

function union(a: Box, b: Box): Box {
  const x = Math.min(a.x, b.x)
  const y = Math.min(a.y, b.y)
  return { x, y, w: Math.max(a.x + a.w, b.x + b.w) - x, h: Math.max(a.y + a.h, b.y + b.h) - y }
}

/** A source canvas already scaled so detection runs in a predictable time budget. */
function toDetectCanvas(source: CanvasImageSource, width: number, height: number): HTMLCanvasElement {
  const maxEdge = 1280
  const scale = Math.min(1, maxEdge / Math.max(width, height))
  const canvas = document.createElement('canvas')
  canvas.width = Math.max(1, Math.round(width * scale))
  canvas.height = Math.max(1, Math.round(height * scale))
  const ctx = canvas.getContext('2d')!
  ctx.drawImage(source, 0, 0, canvas.width, canvas.height)
  return canvas
}

export class DetectorUnavailable extends Error {
  constructor(cause: unknown) {
    super('Face detection runtime unavailable')
    this.name = 'DetectorUnavailable'
    this.cause = cause
  }
}

/**
 * Runs both BlazeFace variants and merges them. The short-range model is sharper
 * on large faces, the full-range model catches distant faces in group shots;
 * running both and de-duplicating is what makes auto-scan reliable across both.
 */
export async function detectFaces(source: CanvasImageSource, width: number, height: number, options: DetectOptions = {}): Promise<DetectedFace[]> {
  let engines: FaceEngines
  try {
    engines = await warm({ onStage: options.onStage })
  } catch (error) {
    throw new DetectorUnavailable(error)
  }
  options.onStage?.('scan')

  const canvas = toDetectCanvas(source, width, height)
  const results: DetectedFace[] = []

  for (const [model, detector] of [
    ['close', engines.close],
    ['wide', engines.wide],
  ] as const) {
    let output: FaceDetectorResult
    try {
      output = detector.detect(canvas)
    } catch {
      continue
    }
    for (const detection of output.detections) {
      if (!detection.boundingBox) continue
      const raw = toBox(detection.boundingBox, canvas.width, canvas.height)
      if (raw.w <= 0 || raw.h <= 0) continue
      results.push({
        box: expandFaceBox(raw),
        raw,
        score: detection.categories[0]?.score ?? 0,
        keypoints: toKeypoints(detection.keypoints ?? [], canvas.width, canvas.height),
        model,
      })
    }
  }

  // BlazeFace will happily hallucinate a face on the back of a head, on clasped
  // hands and on background clutter, all in the 0.4-0.6 band. The balanced
  // default therefore sits at 0.60 — precision first — and the slider drops to
  // 0.30 for anyone who would rather chase recall on hard photos.
  const floor = 0.9 - (options.sensitivity ?? 0.5) * 0.6
  return merge(results)
    .filter((face) => face.score >= floor)
    .sort((a, b) => b.box.w * b.box.h - a.box.w * a.box.h)
}
