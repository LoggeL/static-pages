// Crownward – Kontexthinweis an einem laufenden Bau nennt den Stand der Bauleute (FP-05, sim constructionStatus),
// das Feld nennt seine Wirkung vor den Kosten.
import { describe, expect, it } from 'vitest';
import { BALANCE, createGame, getOffer, type Offer } from '../../src/sim';
import { createCitizen } from '../../src/sim/world';
import { describeOffer } from '../../src/ui/hints';
import { emptyStage, runGame, setDayTime, structureAt } from '../sim/helpers-night';

describe('Hinweis an einem Bau im Gange', () => {
  function stage() {
    const s = emptyStage(createGame({ seed: 51 }));
    s.players[0].x = 0;
    setDayTime(s, 40);
    const wall = structureAt(s, 'wall', 210);
    wall.construction = { toLevel: 1, progress: 0, required: BALANCE.wall.work[1] };
    return { s, wall };
  }

  it('ohne Bauleute: fordert zum Hammerkauf auf', () => {
    const { s, wall } = stage();
    const offer = getOffer(s, wall)!;
    expect(offer.blockedKey).toBe('blocked.building');
    const v = describeOffer(offer, s.players[0], 'S halten', s)!;
    expect(v.tone).toBe('blocked');
    expect(v.detail).toBe('Wartet auf Bauleute – kaufe einen Hammer');
  });

  it('mit Bauarbeiter: „Bauleute arbeiten daran"', () => {
    const { s, wall } = stage();
    createCitizen(s, 'builder', -20);
    runGame(s, 0.1);
    expect(describeOffer(getOffer(s, wall), s.players[0], 'S halten', s)?.detail).toBe('Bauleute arbeiten daran');
  });

  it('nachts an der Front: Bau beginnt bei Tagesanbruch', () => {
    const { s, wall } = stage();
    createCitizen(s, 'builder', -20);
    setDayTime(s, BALANCE.cycle.duskEnd + 5);
    expect(describeOffer(getOffer(s, wall), s.players[0], 'S halten', s)?.detail).toBe('Bauleute beginnen bei Tagesanbruch');
  });

  it('ohne Zustand bleibt der allgemeine Sperrgrund', () => {
    const { s, wall } = stage();
    expect(describeOffer(getOffer(s, wall), s.players[0], 'S halten')?.detail).toBe('Wird gerade gebaut');
  });
});

describe('Feld anlegen', () => {
  it('nennt die Wirkung vor den Kosten', () => {
    const s = createGame({ seed: 1, coop: false });
    const p = s.players[0];
    p.coins = 20;
    const farm = s.structures.find((x) => x.kind === 'farm')!;
    const offer: Offer = {
      structureId: farm.id,
      action: 'buildFarm',
      cost: BALANCE.farm.cost,
      toLevel: 1,
      labelKey: 'offer.buildFarm',
      blockedKey: null,
    };
    expect(describeOffer(offer, p, 'S halten')?.detail).toBe(`Bauern mit Sense ernten hier tagsüber Münzen · ${BALANCE.farm.cost} Münzen`);
  });
});
