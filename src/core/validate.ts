/**
 * Tiny JSON validation helpers shared by every data-format parser (charts,
 * characters, atlases, mod manifests). Errors are human-readable and name
 * the exact path that failed — modder experience is user experience.
 */

export class ValidationError extends Error {}

export function fail(path: string, message: string): never {
  throw new ValidationError(`${path}: ${message}`);
}

export function requireObject(
  value: unknown,
  path: string,
): Record<string, unknown> {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    fail(path, 'expected an object');
  }
  return value as Record<string, unknown>;
}

export function requireString(value: unknown, path: string): string {
  if (typeof value !== 'string') fail(path, 'expected a string');
  return value;
}

export function requireFiniteNumber(value: unknown, path: string): number {
  if (typeof value !== 'number' || !Number.isFinite(value)) {
    fail(path, 'expected a number');
  }
  return value;
}

export function requireBoolean(value: unknown, path: string): boolean {
  if (typeof value !== 'boolean') fail(path, 'expected a boolean');
  return value;
}
