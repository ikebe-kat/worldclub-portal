export function isValidPin(pin: string): boolean {
  return /^\d{4,6}$/.test(pin);
}
