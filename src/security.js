import { randomBytes, scrypt as scryptCallback, timingSafeEqual, createHash } from 'node:crypto';
import { promisify } from 'node:util';
const scrypt = promisify(scryptCallback);
export const token = () => randomBytes(32).toString('base64url');
export const digest = (value) => createHash('sha256').update(value).digest('hex');
export async function hashPassword(password) {
  const salt = randomBytes(16).toString('hex');
  const key = await scrypt(password, salt, 64);
  return `${salt}:${key.toString('hex')}`;
}
export async function verifyPassword(password, stored) {
  const [salt, hex] = stored.split(':');
  const key = await scrypt(password, salt, 64);
  return timingSafeEqual(key, Buffer.from(hex, 'hex'));
}
export function cookieToken(request) {
  return request.headers.cookie
    ?.split(';')
    .map((s) => s.trim())
    .find((s) => s.startsWith('relaydesk='))
    ?.slice(10);
}
export class HttpError extends Error {
  constructor(status, message) {
    super(message);
    this.status = status;
  }
}
export const assert = (condition, status, message) => {
  if (!condition) throw new HttpError(status, message);
};
export function email(value) {
  assert(
    typeof value === 'string' && value.length <= 254 && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value),
    400,
    'Enter a valid email address.',
  );
  return value.toLowerCase().trim();
}
export function loginName(value) {
  assert(
    typeof value === 'string' && /^[a-zA-Z0-9][a-zA-Z0-9_.@+\-]{2,253}$/.test(value),
    400,
    'Use 3–254 letters, numbers, dots, @, +, underscores or hyphens for your username.',
  );
  return value.toLowerCase();
}
export function password(value) {
  assert(
    typeof value === 'string' && value.length >= 12 && value.length <= 128,
    400,
    'Password must contain 12–128 characters.',
  );
  return value;
}
export function integer(value, min, max, label) {
  assert(
    Number.isSafeInteger(value) && value >= min && value <= max,
    400,
    `${label} must be between ${min} and ${max}.`,
  );
  return value;
}
