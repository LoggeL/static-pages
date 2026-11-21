import { RepairGame } from './game/RepairGame';

declare global {
  interface Window {
    __golf7Game?: RepairGame;
  }
}

const appRoot = document.getElementById('app');
if (!appRoot) {
  throw new Error('Root element #app not found');
}

const game = new RepairGame(appRoot);
window.__golf7Game = game;
