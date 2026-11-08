/** A bonus as the sheet writes it: "+3", "+0", "−1" (a true minus sign, not a hyphen). */
export function signed(value: number): string {
  return value < 0 ? `−${-value}` : `+${value}`;
}

let nextId = 0;

/** A document-unique element id, for `aria-labelledby` pairs between a row and its buttons. */
export function uniqueId(prefix: string): string {
  return `${prefix}-${nextId++}`;
}
