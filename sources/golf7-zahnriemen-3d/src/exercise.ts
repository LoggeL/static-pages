import { isAtOT, lockable, parts, wheels } from './drive';
import type { PartId, VisualState, WheelId } from './drive';
import type { Pick } from './viewer';

export const steps = [
  [
    'Steuertrieb freilegen',
    'Der Motor steht. Nimm die Zahnriemenabdeckung im Modell ab, um Räder, Rollen und Bezugsmarken freizulegen.',
  ],
  [
    'Oberen Totpunkt finden',
    'Drehe die Kurbelwelle bis OT (720°). Alle drei orangefarbenen Bezugsmarken an Kurbelwelle, Nockenwelle und Hochdruckpumpe müssen unter ihren festen Zeigern fluchten.',
  ],
  [
    'Wellen arretieren',
    'Stecke Kurbelwelle, Nockenwelle und Hochdruckpumpe mit den Absteckdornen in ihrer OT-Stellung fest. Wähle die drei Räder im 3D-Modell oder unten.',
  ],
  [
    'Alten Riemen abnehmen',
    'Entlaste zuerst die Spannrolle, damit der Riemen entspannt. Hebe den alten Zahnriemen danach ab.',
  ],
  [
    'Neuen Riemen auflegen',
    'Lege den neuen Zahnriemen beginnend an der Kurbelwelle entlang der markierten Spur über alle sieben Räder und Rollen auf.',
  ],
  [
    'Spannung einstellen',
    'Drehe den Exzenter der Spannrolle, bis der orange Zeiger exakt mittig im Referenzfenster der Grundplatte steht.',
  ],
  [
    'Arretierungen lösen',
    'Der neue Zahnriemen liegt sauber auf und ist gespannt. Entferne alle drei Absteckdorne, bevor die Kurbelwelle gedreht wird.',
  ],
  [
    'Steuerzeiten prüfen',
    'Drehe die Kurbelwelle zweimal von Hand durch (720° KW = 360° NW) und prüfe, ob alle drei OT-Markierungen wieder exakt fluchten.',
  ],
] as const;

export class Exercise {
  step = 0;
  angle = 635;
  selected: PartId = 'belt';
  pins: WheelId[] = [];
  released = false;
  routed = 0;
  tension = 0.5;
  checking = false;
  message = '';

  get complete() {
    return this.step === steps.length;
  }

  get visual(): Omit<VisualState, 'neon'> {
    return {
      angle: this.angle,
      selected: this.selected,
      cover: this.step === 0,
      belt: this.step !== 4,
      routing: this.step === 4 ? this.routed : 0,
      routingActive: this.step === 4,
      locks: this.pins,
      tension: this.tension,
      otAligned: isAtOT(this.angle, 4),
    };
  }

  private next(selected: PartId = 'belt') {
    this.step++;
    this.selected = selected;
    this.message = '';
  }

  pick(id: Pick) {
    if (this.step === 0 && id === 'cover') {
      this.action();
      return;
    }
    if (id === 'cover' || this.step === 0) return;
    this.selected = id;

    if (this.step === 2) {
      if (id === 'belt' || !lockable.includes(id)) {
        this.message = 'Arretiere Kurbelwelle, Nockenwelle und Hochdruckpumpe.';
        return;
      }
      if (!this.pins.includes(id)) this.pins.push(id);
      this.message = '';
      if (this.pins.length === lockable.length) this.next('tensioner');
    } else if (
      this.step === 3 &&
      ((!this.released && id === 'tensioner') || (this.released && id === 'belt'))
    ) {
      this.action();
    } else if (this.step === 4) {
      const expected = wheels[this.routed];
      if (id !== expected.id) {
        this.message = 'Nächster Kontakt entlang des Riemenwegs ist „' + expected.name + '“.';
        return;
      }
      this.routed++;
      this.message = '';
      if (this.routed === wheels.length) {
        this.tension = 0.12;
        this.next('tensioner');
      }
    }
  }

  action() {
    this.message = '';
    switch (this.step) {
      case 0:
        this.next('crank');
        break;
      case 1:
        if (!isAtOT(this.angle, 4)) {
          this.message =
            'Die OT-Markierungen fluchten noch nicht. Drehe die Kurbelwelle im Modell auf 720°.';
          break;
        }
        this.angle = 720;
        this.next('crank');
        break;
      case 3:
        if (this.released) this.next('crank');
        else {
          this.released = true;
          this.tension = 0.12;
          this.selected = 'belt';
        }
        break;
      case 5:
        if (Math.abs(this.tension - 0.5) > 0.04) {
          this.message =
            this.tension < 0.5
              ? 'Der Riemen ist zu locker. Drehe den Zeiger nach rechts ins Referenzfenster.'
              : 'Der Riemen ist zu stramm. Drehe den Zeiger nach links ins Referenzfenster.';
          break;
        }
        this.tension = 0.5;
        this.next('crank');
        break;
      case 6:
        this.pins = [];
        this.angle = 0;
        this.next('crank');
        break;
      case 7:
        this.checking = true;
        break;
    }
  }

  advanceCheck(dt: number, reducedMotion: boolean) {
    if (!this.checking) return;
    this.angle = Math.min(720, reducedMotion ? 720 : this.angle + dt * 185);
    if (this.angle === 720) {
      this.checking = false;
      this.next('cam');
    }
  }

  panel() {
    const bars =
      '<div class="step-bars" aria-hidden="true">' +
      steps
        .map(
          (_, i) =>
            '<i class="' + (i < this.step ? 'done' : i === this.step ? 'current' : '') + '"></i>',
        )
        .join('') +
      '</div>';
    if (this.complete) {
      return (
        '<div class="step-head">Übung abgeschlossen</div>' +
        bars +
        '<h2 tabindex="-1">Steuerzeiten passen</h2>' +
        '<p class="completion-text">Nach zwei Umdrehungen der Kurbelwelle hat sich die Nockenwelle einmal gedreht. Alle drei Bezugsmarken stehen wieder unter ihren Zeigern.</p>' +
        '<div class="exercise-actions"><button class="action" id="again">Erneut üben</button></div>'
      );
    }

    const choices = (ids: readonly WheelId[], done: readonly WheelId[], nextExpected?: WheelId) =>
      '<div class="choices">' +
      ids
        .map((id) => {
          const isDone = done.includes(id);
          const isNext = !isDone && nextExpected === id;
          return (
            '<button class="exercise-chip' +
            (isNext ? ' active' : '') +
            '" data-pick="' +
            id +
            '"' +
            (isDone ? ' disabled' : '') +
            '>' +
            (isDone ? '✓ ' : '') +
            parts.find((p) => p.id === id)!.name +
            '</button>'
          );
        })
        .join('') +
      '</div>';

    const action = (label: string) =>
      '<button id="advance" class="action"' +
      (this.checking ? ' disabled' : '') +
      '>' +
      label +
      '</button>';

    let tools = '';
    switch (this.step) {
      case 0:
        tools = action('Abdeckung abnehmen');
        break;
      case 1: {
        const ok = isAtOT(this.angle, 4);
        tools =
          '<label class="exercise-label" for="ot">Kurbelwinkel <b class="exercise-value" id="ot-value">' +
          Math.round(this.angle) +
          '°</b>' +
          '<span class="status-pill' +
          (ok ? ' ok' : '') +
          '" id="ot-status">' +
          (ok ? 'OT erreicht' : 'Ausrichten') +
          '</span></label>' +
          '<input id="ot" type="range" min="620" max="755" value="' +
          this.angle +
          '" aria-label="Kurbelwelle auf OT drehen">' +
          '<div class="range-endpoints"><span>620°</span><span>OT · 720°</span><span>755°</span></div><br>' +
          action('OT bestätigen');
        break;
      }
      case 2:
        tools =
          '<p class="exercise-label">Abgesteckt · <b class="exercise-value">' +
          this.pins.length +
          ' / ' +
          lockable.length +
          '</b></p>' +
          choices(lockable, this.pins);
        break;
      case 3:
        tools = action(this.released ? 'Alten Riemen abnehmen' : 'Spannrolle entlasten');
        break;
      case 4: {
        const nextW = wheels[this.routed];
        tools =
          '<p class="exercise-label">Kontakt ' +
          (this.routed + 1) +
          ' / ' +
          wheels.length +
          ' · <b class="exercise-value">' +
          nextW.name +
          '</b></p>' +
          choices(
            wheels.map((w) => w.id),
            wheels.slice(0, this.routed).map((w) => w.id),
            nextW.id,
          );
        break;
      }
      case 5: {
        const ok = Math.abs(this.tension - 0.5) <= 0.04;
        const status = ok ? 'Im Referenzfenster' : this.tension < 0.5 ? 'Zu locker' : 'Zu stramm';
        tools =
          '<label class="exercise-label" for="tension">Exzenterstellung <span class="status-pill' +
          (ok ? ' ok' : '') +
          '" id="tension-status">' +
          status +
          '</span></label>' +
          '<input id="tension" type="range" min="0" max="100" value="' +
          Math.round(this.tension * 100) +
          '" aria-label="Spannrollen-Exzenter einstellen">' +
          '<div class="range-endpoints"><span>Entlastet</span><span>Referenz · 50</span><span>Stramm</span></div><br>' +
          action('Spannung bestätigen');
        break;
      }
      case 6:
        tools = action('Alle 3 Arretierungen entfernen');
        break;
      case 7:
        tools = action(this.checking ? 'Handprüfung läuft …' : 'Zweimal durchdrehen (720°)');
        break;
    }

    return (
      '<div class="step-head">Schritt ' +
      (this.step + 1) +
      ' / ' +
      steps.length +
      '</div>' +
      bars +
      '<h2 tabindex="-1">' +
      steps[this.step][0] +
      '</h2><p class="step-text">' +
      steps[this.step][1] +
      '</p>' +
      '<div class="exercise-actions">' +
      tools +
      '</div>' +
      '<p class="work-note">Die Übung vereinfacht den Ablauf. Am echten EA288 gelten VW-Reparaturleitfaden, Spezialwerkzeuge und Anzugsdrehmomente.</p>'
    );
  }
}
