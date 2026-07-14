/**
 * The Mods panel — DOM overlay (same pattern as #share-actions) that is the
 * whole content-management surface: drop target feedback, file input
 * fallback, installed list with remove buttons, the validation error list
 * when an import fails, and the auto-chart progress bar. Dropped .zip files
 * and folders install as mods; dropped audio files are auto-charted.
 */

import { AUDIO_FILE_RE, createAutochartManager } from './autochart';
import { idbDeleteMod, idbPutMod, type StoredAutochart, type StoredMod } from './db';
import { fileMapFromDrop, fileMapFromInput } from './drop';
import type { FileMap } from './files';
import type { ContentRegistry } from './registry';
import { validateMod } from './validate';

export interface ModPanelOptions {
  registry: ContentRegistry;
  audio: BaseAudioContext;
  /** Called after any mod is added or removed so screens can refresh. */
  onContentChanged: () => void;
  /** IndexedDB unavailable (e.g. private browsing) → session-only mods. */
  persistent: boolean;
}

export interface ModPanel {
  toggle(): void;
  setVisible(visible: boolean): void;
  readonly visible: boolean;
  /** Show installed mods loaded at boot. */
  refreshList(mods: ReadonlyArray<{ id: string; name: string; summary: string }>): void;
  /** Register auto-charts stored in IndexedDB at boot; returns errors. */
  restoreAutocharts(recs: readonly StoredAutochart[]): string[];
  /** Auto-chart an audio file (also the headless-test entry point). */
  importAudioFile(file: File): Promise<void>;
}

interface InstalledRow {
  id: string;
  name: string;
  summary: string;
}

export function initModPanel(opts: ModPanelOptions): ModPanel {
  const panel = document.querySelector('#mods-panel') as HTMLElement;
  const close = document.querySelector('#mods-close') as HTMLElement;
  const input = document.querySelector('#mod-file-input') as HTMLInputElement;
  const list = document.querySelector('#mods-list') as HTMLUListElement;
  const errorsEl = document.querySelector('#mod-errors') as HTMLUListElement;
  const status = document.querySelector('#mod-status') as HTMLElement;
  const hint = document.querySelector('#mods-drop-hint') as HTMLElement;
  const progress = document.querySelector('#autochart-progress') as HTMLElement;
  const progressFill = document.querySelector('#autochart-progress-fill') as HTMLElement;
  const progressLabel = document.querySelector('#autochart-progress-label') as HTMLElement;

  if (!opts.persistent) {
    hint.textContent +=
      ' (storage unavailable — mods will be forgotten when the tab closes)';
  }

  const installed = new Map<string, InstalledRow>();
  let importing = false;

  const setStatus = (text: string, isError = false) => {
    status.textContent = text;
    status.style.color = isError ? '#ff9db4' : '#8be28b';
  };

  const showErrors = (errors: readonly string[]) => {
    errorsEl.replaceChildren(
      ...errors.map((e) => {
        const li = document.createElement('li');
        li.textContent = e;
        return li;
      }),
    );
    errorsEl.classList.toggle('hidden', errors.length === 0);
  };

  const makeRow = (opts: {
    key: string;
    name: string;
    summary: string;
    onRemove: () => void;
  }): HTMLLIElement => {
    const li = document.createElement('li');
    li.dataset['modId'] = opts.key;

    const label = document.createElement('span');
    label.textContent = opts.name + ' ';
    const meta = document.createElement('span');
    meta.className = 'mod-meta';
    meta.textContent = opts.summary;
    label.appendChild(meta);

    const remove = document.createElement('button');
    remove.type = 'button';
    remove.className = 'mod-remove';
    remove.textContent = 'remove';
    remove.addEventListener('click', opts.onRemove);

    li.append(label, remove);
    return li;
  };

  const renderList = () => {
    list.replaceChildren(
      ...[...installed.values()].map((row) =>
        makeRow({
          key: row.id,
          name: row.name,
          summary: row.summary,
          onRemove: () => void removeMod(row.id),
        }),
      ),
      ...autochart.rows.map((row) =>
        makeRow({
          key: `autochart:${row.hash}`,
          name: row.name,
          summary: row.summary,
          onRemove: () => void autochart.remove(row.hash),
        }),
      ),
    );
  };

  const autochart = createAutochartManager({
    registry: opts.registry,
    audio: opts.audio,
    persistent: opts.persistent,
    ui: {
      setStatus,
      showErrors,
      setProgress(state) {
        progress.classList.toggle('hidden', state === null);
        if (state) {
          progressFill.style.width = `${state.percent}%`;
          progressLabel.textContent = state.label;
        }
      },
      renderRows: () => renderList(),
      onContentChanged: () => opts.onContentChanged(),
    },
  });

  const removeMod = async (id: string) => {
    const name = installed.get(id)?.name ?? id;
    opts.registry.removeMod(id);
    installed.delete(id);
    renderList();
    setStatus(`removed "${name}"`);
    opts.onContentChanged();
    if (opts.persistent) {
      try {
        await idbDeleteMod(id);
      } catch (e) {
        console.error('mod delete failed', e);
      }
    }
  };

  const importFiles = async (getFiles: () => Promise<FileMap>) => {
    if (importing) return;
    importing = true;
    api.setVisible(true);
    showErrors([]);
    setStatus('importing…');
    try {
      const files = await getFiles();
      const result = await validateMod(files, opts.audio);
      if (!result.ok) {
        showErrors(result.errors);
        setStatus(
          `mod not installed — ${result.errors.length} problem${result.errors.length === 1 ? '' : 's'} found`,
          true,
        );
        return;
      }

      const { parsed } = result;
      opts.registry.registerMod(parsed, files);
      const summary = summarize(parsed);
      installed.set(parsed.manifest.id, {
        id: parsed.manifest.id,
        name: parsed.manifest.name,
        summary,
      });
      renderList();
      setStatus(`added "${parsed.manifest.name}" — ${summary}`);
      opts.onContentChanged();

      if (opts.persistent) {
        const stored: StoredMod = {
          id: parsed.manifest.id,
          manifest: parsed.manifest,
          files: Object.fromEntries(files),
          addedAt: Date.now(),
        };
        try {
          await idbPutMod(stored);
        } catch (e) {
          console.error('mod persist failed', e);
          setStatus(
            `added "${parsed.manifest.name}" (but saving for next session failed)`,
            true,
          );
        }
      }
    } catch (e) {
      showErrors([e instanceof Error ? e.message : String(e)]);
      setStatus('mod not installed', true);
    } finally {
      importing = false;
    }
  };

  // Drops are accepted anywhere in the window; the body gets a highlight.
  window.addEventListener('dragover', (e) => {
    e.preventDefault();
    document.body.classList.add('mod-dragover');
  });
  window.addEventListener('dragleave', (e) => {
    if (e.relatedTarget === null) document.body.classList.remove('mod-dragover');
  });
  // A single dropped audio file goes to the auto-charter; it may replace a
  // running analysis but must not race a mod import.
  const importAudio = async (file: File) => {
    if (importing) return;
    api.setVisible(true);
    await autochart.importAudioFile(file);
  };

  window.addEventListener('drop', (e) => {
    e.preventDefault();
    document.body.classList.remove('mod-dragover');
    const dt = e.dataTransfer;
    if (!dt) return;
    // Everything here must read dt synchronously — the DataTransferItemList
    // is neutered as soon as the handler yields (getAsFile is sync-safe).
    const items = Array.from(dt.items).filter((i) => i.kind === 'file');
    const soleEntry = items.length === 1 ? items[0]!.webkitGetAsEntry() : null;
    const soleFile = soleEntry?.isFile ? items[0]!.getAsFile() : null;
    if (soleFile && AUDIO_FILE_RE.test(soleFile.name)) {
      void importAudio(soleFile);
      return;
    }
    void importFiles(() => fileMapFromDrop(dt));
  });

  input.addEventListener('change', () => {
    const file = input.files?.[0];
    input.value = '';
    if (!file) return;
    if (AUDIO_FILE_RE.test(file.name)) void importAudio(file);
    else void importFiles(() => fileMapFromInput(file));
  });

  close.addEventListener('click', () => api.setVisible(false));

  const api: ModPanel = {
    get visible() {
      return !panel.classList.contains('hidden');
    },
    toggle() {
      api.setVisible(!api.visible);
    },
    setVisible(visible: boolean) {
      panel.classList.toggle('hidden', !visible);
    },
    refreshList(mods) {
      installed.clear();
      for (const mod of mods) installed.set(mod.id, { ...mod });
      renderList();
    },
    restoreAutocharts(recs) {
      const errors = autochart.restore(recs);
      renderList();
      return errors;
    },
    importAudioFile: (file) => importAudio(file),
  };
  return api;
}

export function summarize(parsed: {
  songs: readonly unknown[];
  characters: readonly unknown[];
  foods: readonly unknown[];
}): string {
  const parts: string[] = [];
  const add = (n: number, word: string) => {
    if (n > 0) parts.push(`${n} ${word}${n === 1 ? '' : 's'}`);
  };
  add(parsed.songs.length, 'song');
  add(parsed.characters.length, 'character');
  add(parsed.foods.length, 'food');
  return parts.join(', ');
}
