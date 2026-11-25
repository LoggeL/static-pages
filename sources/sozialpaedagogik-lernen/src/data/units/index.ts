import { LearningUnit } from '../../types/curriculum';

import unit01 from './01-bildungsauftrag-recht.json';
import unit02 from './02-taetigkeitsprofil-kompetenzen.json';
import unit03 from './03-querschnittsthemen-bne-digital.json';
import unit04 from './04-fue1-berufliche-kommunikation.json';
import unit05 from './05-fue1-kommunikationsmodelle-moderation.json';
import unit06 from './06-fue2-fremdsprache-praxis.json';
import unit07 from './07-fue3-demokratie-menschenrechte.json';
import unit08 from './08-fue3-arbeitsrecht-mitbestimmung.json';
import unit09 from './09-fue3-kinder-jugendrecht-aufsicht.json';
import unit10 from './10-fue4-digital-datenschutz-kalkulation.json';
import unit11 from './11-fue4-gesundheit-beobachtung-nawi.json';
import unit12 from './12-sp1-berufsmotivation-biografie.json';
import unit13 from './13-sp1-rolle-haltung-naehe-distanz.json';
import unit14 from './14-sp1-gesundheitspraevention-psychohygiene.json';
import unit15 from './15-sp2-bindung-beziehung-erziehungsstile.json';
import unit16 from './16-sp2-partizipation-kinderrechte.json';
import unit17 from './17-sp2-gruppendynamik-soziogramm.json';
import unit18 from './18-sp2-kommunikation-gfk-dialog.json';
import unit19 from './19-sp2-paedagogische-konzepte.json';
import unit20 from './20-sp2-konflikte-deeskalation-mobbing.json';
import unit21 from './21-sp3-normalitaet-inklusion-unbrk.json';
import unit22 from './22-sp3-kultur-diversitaet-gender.json';
import unit23 from './23-sp3-wahrnehmung-beobachtung-doku.json';
import unit24 from './24-sp3-entwicklungspsychologie-theorien.json';
import unit25 from './25-sp3-besondere-bedarfe-teilhabe.json';
import unit26 from './26-sp4-bildungsbegriff-kokonstruktion.json';
import unit27 from './27-sp4-spiel-als-bildung.json';
import unit28 from './28-sp4-beobachtung-raum-projekt.json';
import unit29 from './29-sp4-koerper-bewegung.json';
import unit30 from './30-sp4-gesundheit-ernaehrung.json';
import unit31 from './31-sp4-kuenstlerisch-musik-theater.json';
import unit32 from './32-sp4-sexuelle-bildung.json';
import unit33 from './33-sp4-sprache-literacy.json';
import unit34 from './34-sp4-medien.json';
import unit35 from './35-sp4-naturwissenschaften.json';
import unit36 from './36-sp4-mathematik.json';
import unit37 from './37-sp4-technik.json';
import unit38 from './38-sp5-transitionen-uebergaenge.json';
import unit39 from './39-sp5-kindesschutz-8a-schutzkonzepte.json';
import unit40 from './40-sp5-elternpartnerschaft-gespraeche.json';
import unit41 from './41-sp6-qualitaet-konzeption-organisation.json';
import unit42 from './42-sp6-team-multiprofessionell.json';
import unit43 from './43-sp6-sozialraum-traeger-oeffentlichkeit.json';
import unit44 from './44-sp7ab-religionspaedagogik-ev-kath.json';
import unit45 from './45-sp7c-ethik-philosophieren.json';
import unit46 from './46-sp8-berufspraktikum-reflexion.json';
import unit47 from './47-sp8-abschlussprojekt-kolloquium.json';
import unit48 from './48-sp9-querschnitt-resilienz-systemisch.json';
import unit49 from './49-sp9-arbeitsfelder-kita-hort-gts.json';
import unit50 from './50-sp9-arbeitsfelder-hze-oja-foerder.json';

export const ALL_UNITS: LearningUnit[] = [
  unit01 as unknown as LearningUnit,
  unit02 as unknown as LearningUnit,
  unit03 as unknown as LearningUnit,
  unit04 as unknown as LearningUnit,
  unit05 as unknown as LearningUnit,
  unit06 as unknown as LearningUnit,
  unit07 as unknown as LearningUnit,
  unit08 as unknown as LearningUnit,
  unit09 as unknown as LearningUnit,
  unit10 as unknown as LearningUnit,
  unit11 as unknown as LearningUnit,
  unit12 as unknown as LearningUnit,
  unit13 as unknown as LearningUnit,
  unit14 as unknown as LearningUnit,
  unit15 as unknown as LearningUnit,
  unit16 as unknown as LearningUnit,
  unit17 as unknown as LearningUnit,
  unit18 as unknown as LearningUnit,
  unit19 as unknown as LearningUnit,
  unit20 as unknown as LearningUnit,
  unit21 as unknown as LearningUnit,
  unit22 as unknown as LearningUnit,
  unit23 as unknown as LearningUnit,
  unit24 as unknown as LearningUnit,
  unit25 as unknown as LearningUnit,
  unit26 as unknown as LearningUnit,
  unit27 as unknown as LearningUnit,
  unit28 as unknown as LearningUnit,
  unit29 as unknown as LearningUnit,
  unit30 as unknown as LearningUnit,
  unit31 as unknown as LearningUnit,
  unit32 as unknown as LearningUnit,
  unit33 as unknown as LearningUnit,
  unit34 as unknown as LearningUnit,
  unit35 as unknown as LearningUnit,
  unit36 as unknown as LearningUnit,
  unit37 as unknown as LearningUnit,
  unit38 as unknown as LearningUnit,
  unit39 as unknown as LearningUnit,
  unit40 as unknown as LearningUnit,
  unit41 as unknown as LearningUnit,
  unit42 as unknown as LearningUnit,
  unit43 as unknown as LearningUnit,
  unit44 as unknown as LearningUnit,
  unit45 as unknown as LearningUnit,
  unit46 as unknown as LearningUnit,
  unit47 as unknown as LearningUnit,
  unit48 as unknown as LearningUnit,
  unit49 as unknown as LearningUnit,
  unit50 as unknown as LearningUnit,
];

export const UNITS_BY_ID: Record<string, LearningUnit> = Object.fromEntries(
  ALL_UNITS.map((unit) => [unit.id, unit])
);

export const ALL_FLASHCARDS = ALL_UNITS.flatMap((unit) =>
  unit.flashcards.map((card, cardIndex) => ({
    ...card,
    unitId: unit.id,
    unitNumber: unit.number,
    unitTitle: unit.title,
    moduleCode: unit.moduleCode,
    cardIndex,
  }))
);
