/** Pull an ISBN out of a scanned barcode or typed text: 13 digits starting
    978/979, or 10 characters ending in a digit or X. Same rules as before. */
export function extractISBN(raw: string | null | undefined): string | null {
  if (!raw) return null
  const digits = raw.replace(/[^0-9X]/gi, '').toUpperCase()
  if (digits.length >= 13 && /^97[89]/.test(digits)) return digits.slice(0, 13)
  if (/^[0-9]{9}[0-9X]$/.test(digits)) return digits
  return null
}
