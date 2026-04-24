/** Matches backend :data:`clinical_deid.analytics.stats.UNSPLIT_BUCKET` */
export const UNSPLIT_BUCKET = '(none)';

export function splitLabelForDisplay(key: string): string {
  return key === UNSPLIT_BUCKET ? 'Unassigned' : key;
}
