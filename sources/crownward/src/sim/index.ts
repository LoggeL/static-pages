// Crownward – öffentliche Simulations-API. Renderer, UI, Audio und Tests importieren NUR von hier.
export * from './types';
export type { SimEvent, SimEventType } from './events';
export { BALANCE, ISLAND_1, SIM_DT, SIM_HZ, generateDecor } from './config';
export type { DecorEntry, DecorKind } from './config';
export { createGame } from './world';
export type { NewGameOptions } from './world';
export { stepGame, NO_INPUT } from './step';
export { getOffer, getPlayerFocus } from './offers';
export { constructionStatus } from './citizens';
export type { ConstructionStatus } from './citizens';
export { serializeGame, deserializeGame, SAVE_FORMAT, SAVE_VERSION } from './save';
export type { LoadResult } from './save';
export { townLevel, safeBounds, isInsideWalls, outermostWall } from './util';
export { phaseProgress, cycleFraction } from './daycycle-query';
