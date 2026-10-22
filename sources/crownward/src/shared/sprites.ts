// Crownward – Asset-Vertrag zwischen Art-Pipeline (tools/process-art.mjs) und Renderer.
// Die Pipeline erzeugt public/assets/sprites/atlas.json + PNGs; der Renderer lädt sie über diese IDs.
// Maße in logischen Pixeln (Spielansicht ist 360 logische Pixel hoch, Bodenlinie bei y = 300).

export const LOGICAL_HEIGHT = 360;
export const GROUND_Y = 300;

export interface AtlasFrame {
  x: number;
  y: number;
  w: number;
  h: number;
}

export interface AtlasSprite {
  /** Dateiname relativ zu public/assets/sprites/ */
  image: string;
  frames: AtlasFrame[];
  /** Ankerpunkt relativ zur Frame-Ecke oben links (Standard: Mitte unten = Fußpunkt) */
  anchorX: number;
  anchorY: number;
  /** Animationsgeschwindigkeit, falls mehrere Frames */
  fps?: number;
}

export interface AtlasLayer {
  image: string;
  width: number;
  height: number;
}

export interface Atlas {
  version: 1;
  /** Quelle je Sprite (Rohbild unter assets/generated/) – zur Nachvollziehbarkeit */
  sources: Record<string, string>;
  sprites: Partial<Record<SpriteId, AtlasSprite>>;
  layers: Partial<Record<LayerId, AtlasLayer>>;
}

export type LayerId = 'layer.mountains' | 'layer.forest' | 'layer.ground';

/** Zielhöhe (logische Pixel), erwartete Frames und Quellbogen je Sprite. */
export const SPRITE_SPECS = {
  // Herrscher:in zu Pferd (Quelle: sprites-monarch 4 Schritt + 1 Grasen; Galoppzyklus aus sprites-monarch-gallop)
  'monarch.walk': { height: 54, frames: 4, sheet: 'sprites-monarch' },
  'monarch.gallop': { height: 48, frames: 4, sheet: 'sprites-monarch-gallop' },
  'monarch.graze': { height: 50, frames: 1, sheet: 'sprites-monarch' },
  // Volk (Quelle: sprites-folk 5×2 und sprites-folk-actions 1×6)
  'vagrant.idle': { height: 29, frames: 1, sheet: 'sprites-folk' },
  'vagrant.walk': { height: 29, frames: 2, sheet: 'sprites-folk' },
  'vagrant.kneel': { height: 22, frames: 1, sheet: 'sprites-folk-actions' },
  'villager.idle': { height: 30, frames: 1, sheet: 'sprites-folk' },
  'villager.walk': { height: 30, frames: 2, sheet: 'sprites-folk' },
  'builder.idle': { height: 30, frames: 1, sheet: 'sprites-folk' },
  'builder.walk': { height: 30, frames: 2, sheet: 'sprites-folk' },
  'builder.work': { height: 32, frames: 2, sheet: 'sprites-folk-actions' },
  'archer.idle': { height: 31, frames: 1, sheet: 'sprites-folk' },
  'archer.walk': { height: 31, frames: 2, sheet: 'sprites-folk' },
  'archer.shoot': { height: 31, frames: 2, sheet: 'sprites-folk-actions' },
  'farmer.idle': { height: 31, frames: 1, sheet: 'sprites-folk' },
  'farmer.walk': { height: 31, frames: 2, sheet: 'sprites-folk' },
  'farmer.work': { height: 30, frames: 1, sheet: 'sprites-folk-actions' },
  // Nebelbrut (Quelle: sprites-enemies 4×2)
  'mistling.walk': { height: 18, frames: 2, sheet: 'sprites-enemies' },
  'mistling.attack': { height: 18, frames: 1, sheet: 'sprites-enemies' },
  'mistling.flee': { height: 22, frames: 1, sheet: 'sprites-enemies' },
  'breaker.walk': { height: 46, frames: 2, sheet: 'sprites-enemies' },
  'breaker.attack': { height: 48, frames: 2, sheet: 'sprites-enemies' },
  // Kleinkram (Quelle: sprites-wildlife-props 1×10)
  'rabbit.idle': { height: 9, frames: 1, sheet: 'sprites-wildlife-props' },
  'rabbit.hop': { height: 9, frames: 1, sheet: 'sprites-wildlife-props' },
  coin: { height: 7, frames: 3, sheet: 'sprites-wildlife-props' },
  crown: { height: 8, frames: 1, sheet: 'sprites-wildlife-props' },
  torch: { height: 20, frames: 1, sheet: 'sprites-wildlife-props' },
  bush: { height: 14, frames: 1, sheet: 'sprites-wildlife-props' },
  fern: { height: 12, frames: 1, sheet: 'sprites-wildlife-props' },
  rock: { height: 12, frames: 1, sheet: 'sprites-wildlife-props' },
  // Bäume (Quelle: sprites-trees 1×5)
  'tree.spruce': { height: 150, frames: 1, sheet: 'sprites-trees' },
  'tree.fir': { height: 130, frames: 1, sheet: 'sprites-trees' },
  'tree.pine': { height: 120, frames: 1, sheet: 'sprites-trees' },
  'tree.dead': { height: 118, frames: 1, sheet: 'sprites-trees' },
  'tree.birch': { height: 110, frames: 1, sheet: 'sprites-trees' },
  // Siedlungszentrum Stufe 0..3 (Quelle: buildings-town 1×4)
  'town.0': { height: 44, frames: 1, sheet: 'buildings-town' },
  'town.1': { height: 64, frames: 1, sheet: 'buildings-town' },
  'town.2': { height: 92, frames: 1, sheet: 'buildings-town' },
  'town.3': { height: 124, frames: 1, sheet: 'buildings-town' },
  // Verteidigung (Quelle: buildings-defense 1×6)
  'wall.1': { height: 22, frames: 1, sheet: 'buildings-defense' },
  'wall.2': { height: 44, frames: 1, sheet: 'buildings-defense' },
  'wall.3': { height: 52, frames: 1, sheet: 'buildings-defense' },
  'wall.rubble': { height: 14, frames: 1, sheet: 'buildings-defense' },
  'tower.1': { height: 92, frames: 1, sheet: 'buildings-defense' },
  'tower.2': { height: 104, frames: 1, sheet: 'buildings-defense' },
  // Wirtschaft (Quelle: buildings-economy 1×6)
  farm: { height: 26, frames: 1, sheet: 'buildings-economy' },
  'stand.hammer': { height: 30, frames: 1, sheet: 'buildings-economy' },
  'stand.bow': { height: 30, frames: 1, sheet: 'buildings-economy' },
  'stand.scythe': { height: 30, frames: 1, sheet: 'buildings-economy' },
  buildsite: { height: 22, frames: 1, sheet: 'buildings-economy' },
  camp: { height: 32, frames: 1, sheet: 'buildings-economy' },
  // Wildnis (Quelle: buildings-wild 1×6)
  'chest.closed': { height: 14, frames: 1, sheet: 'buildings-wild' },
  'chest.open': { height: 16, frames: 1, sheet: 'buildings-wild' },
  'shrine.bow': { height: 58, frames: 1, sheet: 'buildings-wild' },
  'shrine.hammer': { height: 36, frames: 1, sheet: 'buildings-wild' },
  rift: { height: 100, frames: 1, sheet: 'buildings-wild' },
  waymarker: { height: 26, frames: 1, sheet: 'buildings-wild' },
  // Schiff (Quelle: ship 1×3): Wrack (Stufe 0), in Reparatur (1–2), seetüchtig (3)
  'ship.wreck': { height: 58, frames: 1, sheet: 'ship' },
  'ship.repair': { height: 104, frames: 1, sheet: 'ship' },
  'ship.ready': { height: 124, frames: 1, sheet: 'ship' },
} as const;

export type SpriteId = keyof typeof SPRITE_SPECS;

export const LAYER_SPECS: Record<LayerId, { height: number; sheet: string; parallax: number }> = {
  'layer.mountains': { height: 170, sheet: 'bg-mountains', parallax: 0.12 },
  'layer.forest': { height: 130, sheet: 'bg-forest', parallax: 0.38 },
  /** Bodenstreifen: Oberkante (Grasspitzen) liegt ca. 18 px über GROUND_Y */
  'layer.ground': { height: 84, sheet: 'bg-ground', parallax: 1 },
};

export const ATLAS_URL = 'assets/sprites/atlas.json';
