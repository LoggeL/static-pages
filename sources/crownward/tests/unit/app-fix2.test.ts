// Crownward – Regressionstests (Brief-Abgleich/Erstspieler-Test, fix2-app): Einführungstext je Gerät (auch Koop
// mit Touch), Schrein-Wirkung im Angebot, Anwerbe-Hinweis bei Landstreichern, Niederlage-Untertitel je Ursache.
import { describe, expect, it } from 'vitest';
import { BALANCE, ISLAND_1, NO_INPUT, createGame, getPlayerFocus, type GameState, type Offer, type PlayerInput } from '../../src/sim';
import { spawnEnemy } from '../../src/sim/enemies';
import { describeOffer, hintText, introText, tapLabel, vagrantHint } from '../../src/ui/hints';
import { defeatCause, endSubtitle } from '../../src/ui/outcome';
import { emptyStage, newGame, ofType, parkPlayers, quietNight, runGame, setWall, tickNight } from '../sim/helpers-night';

// ---------- Einführung (FP-01, G4) ----------

describe('Einführungstext', () => {
  it('Einzelspiel je Gerät', () => {
    expect(introText(false, ['keyboard'], false)).toBe('A/D oder ←/→ reiten · Shift sprinten · S halten zum Bezahlen · H Hilfe');
    expect(introText(false, ['touch'], false)).toBe('◀ ▶ reiten · » sprinten · Münze halten zum Bezahlen');
    expect(introText(false, ['keyboard'], true)).toBe('◀ ▶ reiten · » sprinten · Münze halten zum Bezahlen');
    expect(introText(false, ['gamepad'], false)).toContain('Stick reiten');
  });

  it('Koop mit Tastatur: unverändert beide Tastaturhälften', () => {
    expect(introText(true, ['keyboard', 'keyboard'], false)).toBe('Spieler 1: A/D · Shift links · S   —   Spieler 2: ←/→ · Shift rechts · ↓');
  });

  it('Koop mit Touch: Spieler 1 sieht Bildschirmtasten statt Tastaturtasten', () => {
    const txt = introText(true, ['touch', 'keyboard'], true);
    expect(txt).toBe('Spieler 1: ◀ ▶ · » · Münze   —   Spieler 2: ←/→ · Shift rechts · ↓');
    expect(txt).not.toContain('A/D');
    // Spieler 2 mit Gamepad
    expect(introText(true, ['touch', 'gamepad'], true)).toBe('Spieler 1: ◀ ▶ · » · Münze   —   Spieler 2: Stick · X/RB · A');
  });

  it('Startpunkt liegt in Reichweite des Bogenständers – deshalb muss die Einführung neben dem Angebot stehen', () => {
    // Dokumentiert die Ursache von FP-01 (Simulation unverändert): Spieler 1 startet mit einem Angebot im Fokus.
    const g = createGame({ seed: 1, coop: false });
    expect(g.players[0].x).toBe(ISLAND_1.playerStartX[0]);
    expect(getPlayerFocus(g, g.players[0].id)?.labelKey).toBe('offer.buyTool.bow');
  });
});

// ---------- Schrein-Wirkung (FP-09) ----------

describe('Angebotsdetail nennt die Wirkung eines Schreins vor dem Kauf', () => {
  const shrine = (kind: 'bow' | 'hammer'): Offer => ({
    structureId: 9,
    action: 'activateShrine',
    cost: BALANCE.shrines.cost,
    toLevel: 1,
    labelKey: `offer.activateShrine.${kind}`,
    blockedKey: null,
  });

  it('genug Münzen: Wirkung · Kosten', () => {
    const p = createGame({ seed: 1, coop: false }).players[0];
    p.coins = 20;
    expect(hintText(describeOffer(shrine('hammer'), p, 'S halten'))).toBe(
      `Schrein des Hammers – Bauleute arbeiten schneller · ${BALANCE.shrines.cost} Münzen – S halten`,
    );
    expect(describeOffer(shrine('bow'), p, 'S halten')?.detail).toBe(`Bogenschützen schießen weiter und schneller · ${BALANCE.shrines.cost} Münzen`);
  });

  it('zu wenig Münzen: Wirkung bleibt sichtbar, dazu was fehlt', () => {
    const p = createGame({ seed: 1, coop: false }).players[0];
    p.coins = BALANCE.shrines.cost - 2;
    expect(describeOffer(shrine('hammer'), p, 'S halten')?.detail).toBe(
      `Bauleute arbeiten schneller · ${BALANCE.shrines.cost} Münzen · Dir fehlen 2 Münzen`,
    );
  });

  it('andere Angebote unverändert (Name sagt die Wirkung)', () => {
    const p = createGame({ seed: 1, coop: false }).players[0];
    const bow: Offer = { structureId: 3, action: 'buyTool', cost: 2, toLevel: 0, labelKey: 'offer.buyTool.bow', blockedKey: null };
    expect(describeOffer(bow, p, 'S halten')?.detail).toBe('2 Münzen');
  });
});

// ---------- Anwerbe-Hinweis (FP-04) ----------

describe('Anwerbe-Hinweis bei Landstreichern', () => {
  function settled(seed = 4242): GameState {
    const g = createGame({ seed, coop: false });
    runGame(g, 2); // Landstreicher beziehen ihren Platz am Lagerfeuer
    g.coins = []; // Startmünzen auf dem Weg stören die Beobachtung nicht
    return g;
  }

  it('Taste je Gerät', () => {
    expect(tapLabel('keyboard', 0, false)).toBe('S / ↓ tippen');
    expect(tapLabel('keyboard', 0, false, 'wasd')).toBe('S tippen');
    expect(tapLabel('keyboard', 1, true)).toBe('↓ tippen');
    expect(tapLabel('touch', 0, false)).toBe('Münze tippen');
    expect(tapLabel('gamepad', 0, false)).toBe('A tippen');
  });

  it('abseits der Angebote neben einem Landstreicher: Hinweis „S tippen"', () => {
    const g = settled();
    const p = g.players[0];
    p.x = 104;
    p.facing = -1;
    const focus = getPlayerFocus(g, p.id);
    expect(focus).toBeNull();
    expect(hintText(vagrantHint(g, p, focus, 'S tippen'))).toBe('Landstreicher – Münze hinwerfen – er schließt sich dir an – S tippen');
  });

  it('kein Hinweis: Angebot in Reichweite, leerer Beutel, weit weg, Spielende', () => {
    const g = settled();
    const p = g.players[0];
    p.x = 50; // Bogenständer
    expect(vagrantHint(g, p, getPlayerFocus(g, p.id), 'S tippen')).toBeNull();
    p.x = 104;
    p.facing = -1;
    p.coins = 0;
    expect(vagrantHint(g, p, null, 'S tippen')).toBeNull();
    p.coins = 5;
    p.x = 400;
    expect(vagrantHint(g, p, getPlayerFocus(g, p.id), 'S tippen')).toBeNull();
    p.x = 104;
    g.outcome = 'defeat';
    expect(vagrantHint(g, p, null, 'S tippen')).toBeNull();
  });

  it('wo der Hinweis erscheint, wirbt ein kurzer Druck den Landstreicher tatsächlich an', () => {
    const tap: PlayerInput = { ...NO_INPUT, act: true };
    let shown = 0;
    for (const facing of [-1, 1] as const) {
      for (let x = 70; x <= 200; x += 6) {
        const g = settled();
        const p = g.players[0];
        p.x = x;
        p.vx = 0;
        p.facing = facing;
        const hint = vagrantHint(g, p, getPlayerFocus(g, p.id), 'S tippen');
        if (!hint) continue;
        shown++;
        const recruits = ofType([...runGame(g, 1 / 60, [tap]), ...runGame(g, 20, [NO_INPUT])], 'recruit');
        expect(recruits.length, `x=${x}, Blick ${facing}`).toBeGreaterThan(0);
      }
    }
    expect(shown).toBeGreaterThan(4);
  });
});

// ---------- Niederlage-Untertitel (FP-06) ----------

describe('Untertitel der Niederlage nennt die Ursache', () => {
  function arena(coop = false): GameState {
    const s = emptyStage(newGame({ coop }));
    quietNight(s);
    parkPlayers(s, -1800);
    return s;
  }

  /** Mistling trifft Spieler i ohne Münzen bei x → Kronverlust; liefert das Ereignis. */
  function loseCrownAt(s: GameState, x: number, i = 0) {
    const p = s.players[i];
    p.x = x;
    p.coins = 0;
    spawnEnemy(s, 'mistling', 1, x + 20);
    const lost = ofType(tickNight(s, 1.5), 'crownLost');
    expect(lost).toHaveLength(1);
    expect(s.outcome).toBe('defeat');
    return { playerId: lost[0].playerId, x: lost[0].x };
  }

  it('draußen ohne jede Mauer auf dieser Seite (Erstspieler-Fall x≈676)', () => {
    const s = arena();
    const loss = loseCrownAt(s, 676);
    expect(s.stats.wallsLost).toBe(0);
    expect(defeatCause(s, loss)).toBe('noWall');
    expect(endSubtitle('defeat', s, loss)).toBe('Ohne schützende Mauer hat dir die Nebelbrut die Krone entrissen.');
  });

  it('draußen vor der äußersten Mauer', () => {
    const s = arena();
    setWall(s, 210, 1);
    const loss = loseCrownAt(s, 676);
    expect(endSubtitle('defeat', s, loss)).toBe('Draußen vor den Mauern hat dir die Nebelbrut die Krone entrissen.');
  });

  it('hinter der Mauerlinie, nachdem Mauern gefallen sind: überrannt', () => {
    const s = arena();
    setWall(s, 210, 0).maxHp = BALANCE.wall.hp[1]; // Trümmer einer gefallenen Mauer
    s.stats.wallsLost = 1;
    const loss = loseCrownAt(s, 120);
    expect(defeatCause(s, loss)).toBe('overrun');
    expect(endSubtitle('defeat', s, loss)).toBe('Die Nebelbrut hat Morgenrand überrannt.');
  });

  it('hinter intakten Mauern getroffen: allgemeiner Text', () => {
    const s = arena();
    setWall(s, 210, 1);
    const loss = loseCrownAt(s, 120);
    expect(endSubtitle('defeat', s, loss)).toBe('Die Nebelbrut hat dir die Krone entrissen.');
  });

  it('Koop nennt den Spieler, der die Krone verlor', () => {
    const s = arena(true);
    setWall(s, 210, 1);
    const loss = loseCrownAt(s, 700, 1);
    expect(endSubtitle('defeat', s, loss)).toBe('Draußen vor den Mauern hat die Nebelbrut Spieler 2 die Krone entrissen.');
  });

  it('ohne Ereignis: Ort aus dem Herrscher ohne Krone; Sieg unverändert', () => {
    const s = arena();
    loseCrownAt(s, 900);
    expect(endSubtitle('defeat', s, null)).toBe('Ohne schützende Mauer hat dir die Nebelbrut die Krone entrissen.');
    expect(endSubtitle('victory', createGame({ seed: 1, coop: false }), null)).toBe('Das Schiff legt ab – Morgenrand liegt hinter euch.');
  });
});
