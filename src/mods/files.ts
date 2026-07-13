/**
 * FileMap — the normalized in-memory form of a mod, however it arrived
 * (dropped folder, dropped .zip, file input). Paths are '/'-separated,
 * relative to the mod root, with no leading './'.
 */

export type FileMap = ReadonlyMap<string, Blob>;

export function normalizePath(path: string): string {
  let p = path.replace(/\\/g, '/');
  while (p.startsWith('./') || p.startsWith('/')) {
    p = p.startsWith('./') ? p.slice(2) : p.slice(1);
  }
  return p;
}

/**
 * If every file sits under one shared top-level directory and mod.json is
 * not already at the root, strip that directory. Handles both "compress
 * the folder" zips (my-mod/mod.json) and dropped folders.
 */
export function stripCommonRoot(files: Map<string, Blob>): Map<string, Blob> {
  if (files.has('mod.json') || files.size === 0) return files;
  let root: string | null = null;
  for (const path of files.keys()) {
    const slash = path.indexOf('/');
    if (slash <= 0) return files;
    const top = path.slice(0, slash);
    if (root === null) root = top;
    else if (top !== root) return files;
  }
  const stripped = new Map<string, Blob>();
  for (const [path, blob] of files) {
    stripped.set(path.slice(root!.length + 1), blob);
  }
  return stripped;
}

/** Resolve a reference relative to the JSON file that declared it. */
export function resolveRelative(baseJsonPath: string, ref: string): string {
  const slash = baseJsonPath.lastIndexOf('/');
  const dir = slash === -1 ? '' : baseJsonPath.slice(0, slash + 1);
  const parts: string[] = [];
  for (const part of normalizePath(dir + ref).split('/')) {
    if (part === '' || part === '.') continue;
    if (part === '..') parts.pop();
    else parts.push(part);
  }
  return parts.join('/');
}
