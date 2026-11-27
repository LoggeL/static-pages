import type { LearningUnit, ModuleArea, ProgressState } from '../types/curriculum.ts';

export const DEFAULT_PRIMARY_STARTER_ID = '15-sp2-bindung-beziehung-erziehungsstile';

export const FEATURED_STARTER_UNIT_IDS = [
  '15-sp2-bindung-beziehung-erziehungsstile',
  '23-sp3-wahrnehmung-beobachtung-doku',
  '33-sp4-sprache-literacy',
  '39-sp5-kindesschutz-8a-schutzkonzepte',
] as const;

const AREA_SORT_ORDER: Record<ModuleArea, number> = {
  'sp-pflicht': 0,
  'sp-wahlpflicht': 1,
  fue: 2,
  grundlagen: 3,
};

export function isOrientationUnit(unit: Pick<LearningUnit, 'unitRole' | 'moduleCode' | 'moduleArea'>): boolean {
  return (
    unit.unitRole === 'orientation' ||
    unit.moduleCode === 'LEITLINIEN' ||
    unit.moduleArea === 'grundlagen'
  );
}

/**
 * Bestimmt die zentrale Einstiegs-Einheit für den 1-Klick-Start.
 * - Bei Rückkehr zu einer fachlichen Kerneinheit wird dort weitergelernt (`isResuming: true`).
 * - Bei frischem Profil ODER wenn `lastVisitedUnitId` auf eine Orientierungseinheit (01–03 / LEITLINIEN)
 *   zeigt, startet der Haupt-CTA direkt in der empfohlenen fachlichen Kerneinheit (Bindung & Beziehung),
 *   damit der Einstieg nicht auf Ausbildungsorganisation/Stundentafel verengt.
 */
export function getPrimaryStarterUnit(
  units: LearningUnit[],
  state: ProgressState
): { unit: LearningUnit | undefined; isResuming: boolean } {
  if (state.lastVisitedUnitId) {
    const visited = units.find((u) => u.id === state.lastVisitedUnitId);
    if (visited && !isOrientationUnit(visited)) {
      return { unit: visited, isResuming: true };
    }
  }

  const preferred = units.find((u) => u.id === DEFAULT_PRIMARY_STARTER_ID);
  if (preferred) {
    return { unit: preferred, isResuming: false };
  }

  const firstCore = units.find((u) => !isOrientationUnit(u));
  return { unit: firstCore ?? units[0], isResuming: false };
}

/**
 * Liefert kuratierte fachliche Einstiegseinheiten für den 1-Klick-Start auf der Startseite.
 */
export function getFeaturedStarterUnits(units: LearningUnit[]): LearningUnit[] {
  const byId = new Map(units.map((u) => [u.id, u]));
  const picked: LearningUnit[] = [];

  for (const id of FEATURED_STARTER_UNIT_IDS) {
    const match = byId.get(id);
    if (match && !isOrientationUnit(match)) {
      picked.push(match);
    }
  }

  if (picked.length < 4) {
    for (const unit of units) {
      if (!isOrientationUnit(unit) && !picked.some((p) => p.id === unit.id)) {
        picked.push(unit);
        if (picked.length === 4) break;
      }
    }
  }

  return picked;
}

/**
 * Ordnet Module so, dass die fachlichen Lernmodule (Sozialpädagogik Pflicht,
 * Wahlpflicht, Fachrichtungsübergreifend) im Lernpfad voranstehen und
 * Orientierungseinheiten separat nachschlagbar eingeordnet werden.
 */
export function getOrderedModulesForLearningPath<
  T extends { code: string; area: ModuleArea }
>(modules: T[]): { coreModules: T[]; orientationModules: T[] } {
  const coreModules = modules
    .filter((m) => m.area !== 'grundlagen' && m.code !== 'LEITLINIEN')
    .sort((a, b) => AREA_SORT_ORDER[a.area] - AREA_SORT_ORDER[b.area]);
  const orientationModules = modules.filter(
    (m) => m.area === 'grundlagen' || m.code === 'LEITLINIEN'
  );
  return { coreModules, orientationModules };
}

export function getSafeExternalUrl(rawUrl: string): string | null {
  try {
    const parsed = new URL(rawUrl.trim());
    if (parsed.protocol === 'https:' || parsed.protocol === 'http:') {
      return parsed.toString();
    }
    return null;
  } catch {
    return null;
  }
}

export function getSourceHostname(rawUrl: string): string {
  try {
    return new URL(rawUrl.trim()).hostname.replace(/^www\./, '');
  } catch {
    return rawUrl;
  }
}

export function getCurriculumReferenceLabel(
  unit: Pick<LearningUnit, 'curriculumRef' | 'moduleCode' | 'hoursRef' | 'pdfPages'>,
  moduleTitle?: string
): string {
  if (unit.curriculumRef && unit.curriculumRef.trim()) {
    return unit.curriculumRef.trim();
  }
  const modPart = moduleTitle ? `${unit.moduleCode} – ${moduleTitle}` : unit.moduleCode;
  return `${modPart} (${unit.hoursRef}, Lehrplan RLP 2024, ${unit.pdfPages})`;
}

export function buildUnitHashLink(unitId: string): string {
  return `#/einheit/${encodeURIComponent(unitId)}`;
}
