/** Unpack a .zip into a FileMap using zip.js. */

import { BlobReader, BlobWriter, ZipReader, configure } from '@zip.js/zip.js';
import { normalizePath, stripCommonRoot, type FileMap } from './files';

// Main-thread inflate: mods are small, and worker bundling under Vite's
// relative base ('./', for GitHub Pages) is the flaky part of zip.js.
configure({ useWebWorkers: false });

export async function unzipToFileMap(blob: Blob): Promise<FileMap> {
  const reader = new ZipReader(new BlobReader(blob));
  try {
    const files = new Map<string, Blob>();
    for (const entry of await reader.getEntries()) {
      if (entry.directory || !entry.getData) continue;
      const path = normalizePath(entry.filename);
      // Junk dirs macOS sneaks into zips.
      if (path.startsWith('__MACOSX/') || path.split('/').pop() === '.DS_Store') {
        continue;
      }
      files.set(path, await entry.getData(new BlobWriter()));
    }
    if (files.size === 0) throw new Error('zip file is empty');
    return stripCommonRoot(files);
  } finally {
    await reader.close();
  }
}
