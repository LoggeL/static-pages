// Crownward – Ereignisse eines Simulationsschritts. stepGame() gibt sie zurück; sie werden NICHT gespeichert.
// Verbraucher: Renderer (Partikel, Kamerawackeln), Audio (Klänge), UI (Hinweise/Toasts).
// VERTRAG: neue Ereignistypen dürfen ergänzt werden; bestehende Felder nicht umbenennen.

import type { DayPhase, EnemyKind, OfferAction, Role, ShrineKind, Side, StructureKind, ToolKind } from './types';

export type SimEvent =
  | { type: 'coinPickup'; x: number; playerId: number; coins: number }
  | { type: 'coinDrop'; x: number; playerId: number }
  | { type: 'purseFull'; x: number; playerId: number }
  | { type: 'coinPaid'; x: number; playerId: number; structureId: number; paid: number; cost: number }
  | { type: 'payCancelled'; x: number; playerId: number; structureId: number; refunded: number }
  | { type: 'purchase'; x: number; playerId: number; structureId: number; action: OfferAction; cost: number }
  | { type: 'toolStocked'; x: number; tool: ToolKind; structureId: number }
  | { type: 'buildStart'; x: number; structureId: number; kind: StructureKind; toLevel: number }
  | { type: 'buildComplete'; x: number; structureId: number; kind: StructureKind; level: number }
  | { type: 'hammer'; x: number; citizenId: number }
  | { type: 'repaired'; x: number; structureId: number }
  | { type: 'recruit'; x: number; citizenId: number }
  | { type: 'roleChange'; x: number; citizenId: number; role: Role }
  | { type: 'vagrantSpawn'; x: number; citizenId: number }
  | { type: 'harvest'; x: number; structureId: number }
  | { type: 'arrowFired'; x: number; y: number; citizenId: number }
  | { type: 'arrowHit'; x: number; y: number; target: 'enemy' | 'rabbit' | 'ground' }
  | { type: 'rabbitKilled'; x: number }
  | { type: 'enemySpawn'; x: number; side: Side; kind: EnemyKind }
  | { type: 'enemyHit'; x: number; enemyId: number; kind: EnemyKind }
  | { type: 'enemyDied'; x: number; kind: EnemyKind }
  | { type: 'enemyEscaped'; x: number; kind: EnemyKind; carrying: 'coin' | 'tool' | 'crown' | null }
  | { type: 'enemiesDissolved'; count: number; xs: number[] }
  | { type: 'wallHit'; x: number; structureId: number; hp: number; maxHp: number }
  | { type: 'wallDestroyed'; x: number; structureId: number }
  | { type: 'playerHit'; x: number; playerId: number; coinsLost: number }
  | { type: 'citizenHit'; x: number; citizenId: number; role: Role }
  | { type: 'crownLost'; x: number; playerId: number }
  | { type: 'phaseChange'; phase: DayPhase; day: number }
  | { type: 'nightWarning'; day: number; paleMoon: boolean }
  | { type: 'chestOpened'; x: number; structureId: number; coins: number }
  | { type: 'shrineActivated'; x: number; structureId: number; shrine: ShrineKind }
  | { type: 'shipStage'; x: number; level: number }
  | { type: 'victory'; x: number }
  | { type: 'defeat'; x: number };

export type SimEventType = SimEvent['type'];
