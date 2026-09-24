import bcrypt from 'bcryptjs';

const ROUNDS = 10;
export const hashPassword = (plain) => bcrypt.hash(plain, ROUNDS);
export const hashPasswordSync = (plain) => bcrypt.hashSync(plain, ROUNDS);
export const verifyPassword = (plain, hash) => bcrypt.compare(plain, hash);

/** Minimum policy: 8+ chars with a letter and a digit. Returns an error key or null. */
export function passwordProblem(p) {
  if (typeof p !== 'string' || p.length < 8) return 'password_too_short';
  if (!/[A-Za-z]/.test(p) || !/\d/.test(p)) return 'password_needs_letter_and_number';
  return null;
}
