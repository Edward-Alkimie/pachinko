/** A long hex value shortened for display: `01234567…cdef`. */
export const shortHex = (hex: string) => `${hex.slice(0, 8)}…${hex.slice(-4)}`
