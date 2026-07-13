/**
 * Turn a drag-and-drop payload or a picked file into a FileMap.
 *
 * Folder drops use webkitGetAsEntry (supported by every modern browser
 * despite the prefix). The entries MUST be snapshotted synchronously —
 * the DataTransferItemList is neutered as soon as the drop handler yields.
 */

import { normalizePath, stripCommonRoot, type FileMap } from './files';
import { unzipToFileMap } from './zip';

export async function fileMapFromDrop(dt: DataTransfer): Promise<FileMap> {
  // Synchronous snapshot — no awaits above this loop.
  const entries: FileSystemEntry[] = [];
  for (const item of Array.from(dt.items)) {
    if (item.kind !== 'file') continue;
    const entry = item.webkitGetAsEntry();
    if (entry) entries.push(entry);
  }

  if (entries.length === 0) {
    throw new Error('nothing droppable found — drop a mod folder or a .zip');
  }

  const first = entries[0]!;
  if (entries.length === 1 && first.isFile && /\.zip$/i.test(first.name)) {
    return unzipToFileMap(await entryFile(first as FileSystemFileEntry));
  }

  // One dropped folder → its contents are the mod root. Multiple items
  // (loose files selected together) → treat the drop itself as the root.
  const files = new Map<string, Blob>();
  for (const entry of entries) {
    await collect(entry, '', files, entries.length === 1 && entry.isDirectory);
  }
  if (files.size === 0) {
    throw new Error('dropped folder is empty');
  }
  return stripCommonRoot(files);
}

/** The <input type="file"> fallback — .zip only, works in every browser. */
export async function fileMapFromInput(file: File): Promise<FileMap> {
  if (!/\.zip$/i.test(file.name)) {
    throw new Error(`"${file.name}": expected a .zip file`);
  }
  return unzipToFileMap(file);
}

async function collect(
  entry: FileSystemEntry,
  prefix: string,
  out: Map<string, Blob>,
  isRoot: boolean,
): Promise<void> {
  if (entry.isFile) {
    if (entry.name === '.DS_Store') return;
    out.set(normalizePath(prefix + entry.name), await entryFile(entry as FileSystemFileEntry));
    return;
  }
  if (!entry.isDirectory) return;
  // A single dropped folder is the mod root itself; don't prefix its name.
  const childPrefix = isRoot ? '' : `${prefix}${entry.name}/`;
  const dirReader = (entry as FileSystemDirectoryEntry).createReader();
  // readEntries returns batches (Chrome caps at 100); loop until empty.
  for (;;) {
    const batch = await new Promise<FileSystemEntry[]>((resolve, reject) =>
      dirReader.readEntries(resolve, reject),
    );
    if (batch.length === 0) break;
    for (const child of batch) await collect(child, childPrefix, out, false);
  }
}

function entryFile(entry: FileSystemFileEntry): Promise<File> {
  return new Promise((resolve, reject) => entry.file(resolve, reject));
}
