export const CANONICAL_LABELS = [
  'NAME', 'PATIENT', 'DOCTOR', 'STAFF', 'HCW',
  'ADDRESS', 'LOCATION', 'CITY', 'STATE', 'COUNTRY', 'ZIP_CODE', 'POSTAL_CODE',
  'DATE', 'DATE_TIME',
  'PHONE', 'FAX',
  'EMAIL',
  'SSN',
  'MRN',
  'ID', 'ACCOUNT', 'LICENSE',
  'VEHICLE_ID', 'DEVICE_ID',
  'URL', 'IP_ADDRESS',
  'BIOMETRIC', 'PHOTO',
  'AGE', 'ORGANIZATION', 'HOSPITAL', 'IDNUM', 'OHIP', 'SIN', 'PERSON',
  'OTHER',
] as const;

export type CanonicalLabel = (typeof CANONICAL_LABELS)[number];
