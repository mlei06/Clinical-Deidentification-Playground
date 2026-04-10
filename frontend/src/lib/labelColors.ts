const KNOWN_COLORS: Record<string, { bg: string; text: string; border: string }> = {
  PATIENT:    { bg: '#fee2e2', text: '#991b1b', border: '#fca5a5' },
  NAME:       { bg: '#fee2e2', text: '#991b1b', border: '#fca5a5' },
  DATE:       { bg: '#dbeafe', text: '#1e40af', border: '#93c5fd' },
  HOSPITAL:   { bg: '#dcfce7', text: '#166534', border: '#86efac' },
  LOCATION:   { bg: '#dcfce7', text: '#166534', border: '#86efac' },
  ADDRESS:    { bg: '#dcfce7', text: '#166534', border: '#86efac' },
  PHONE:      { bg: '#ffedd5', text: '#9a3412', border: '#fdba74' },
  EMAIL:      { bg: '#fef3c7', text: '#92400e', border: '#fcd34d' },
  ID:         { bg: '#e0e7ff', text: '#3730a3', border: '#a5b4fc' },
  MRN:        { bg: '#e0e7ff', text: '#3730a3', border: '#a5b4fc' },
  SSN:        { bg: '#fce7f3', text: '#9d174d', border: '#f9a8d4' },
  AGE:        { bg: '#f3e8ff', text: '#6b21a8', border: '#c4b5fd' },
  DOCTOR:     { bg: '#fef9c3', text: '#854d0e', border: '#fde047' },
  ZIP_CODE_US:{ bg: '#ccfbf1', text: '#115e59', border: '#5eead4' },
};

const PALETTE = [
  { bg: '#fae8ff', text: '#86198f', border: '#e879f9' },
  { bg: '#e0f2fe', text: '#075985', border: '#7dd3fc' },
  { bg: '#ecfccb', text: '#3f6212', border: '#bef264' },
  { bg: '#fff1f2', text: '#9f1239', border: '#fda4af' },
  { bg: '#f0fdf4', text: '#14532d', border: '#86efac' },
  { bg: '#fdf4ff', text: '#701a75', border: '#d946ef' },
  { bg: '#eff6ff', text: '#1e3a8a', border: '#60a5fa' },
  { bg: '#fefce8', text: '#713f12', border: '#facc15' },
];

function hashStr(s: string): number {
  let h = 0;
  for (let i = 0; i < s.length; i++) {
    h = ((h << 5) - h + s.charCodeAt(i)) | 0;
  }
  return Math.abs(h);
}

export function labelColor(label: string): { bg: string; text: string; border: string } {
  const upper = label.toUpperCase();
  if (KNOWN_COLORS[upper]) return KNOWN_COLORS[upper];
  return PALETTE[hashStr(upper) % PALETTE.length];
}
