/**
 * Design ruling 5's `.hero` export delivery ladder: `showSaveFilePicker` → `navigator.share({files})`
 * (iOS) → an `<a download>` object-URL fallback. A plain, DI-free function (not an Angular service)
 * so a spec can drive it directly against stubbed `window`/`navigator` globals with no TestBed at
 * all — `HeroWriterService.export()` only ever BUILDS the bundle; this is the separate, sibling step
 * that hands the built `{blob, fileName}` to the browser.
 *
 * `showSaveFilePicker` (the File System Access API) isn't in TypeScript's bundled `lib.dom.d.ts`
 * (unlike `navigator.share`/`canShare`, which are) — `WindowWithSaveFilePicker` below is this
 * file's own minimal local typing for the one shape it actually calls, not a global ambient
 * declaration.
 */

export type HeroDeliveryOutcome = 'saved' | 'shared' | 'downloaded' | 'cancelled';

interface FileSystemWritableFileStreamLike {
  write(data: Blob): Promise<void>;
  close(): Promise<void>;
}

interface FileSystemFileHandleLike {
  createWritable(): Promise<FileSystemWritableFileStreamLike>;
}

interface SaveFilePickerOptions {
  suggestedName?: string;
  types?: readonly { description?: string; accept: Record<string, string[]> }[];
}

interface WindowWithSaveFilePicker {
  showSaveFilePicker?: (options?: SaveFilePickerOptions) => Promise<FileSystemFileHandleLike>;
}

/** The user backing out of the picker/share sheet is a normal outcome (`AbortError`), not a
 * failure to fall through the ladder for — any OTHER rejection (a half-implemented browser API,
 * a permission failure) falls through to the next rung instead. */
function isUserAbort(err: unknown): boolean {
  return err instanceof DOMException && err.name === 'AbortError';
}

/** `description` (fix-wave review, minor finding 5): the save-picker's file-type label — shown by
 * the browser/OS chrome itself, so it must be LOCALIZED text, never a bare English literal. This
 * plain, DI-free function has no Transloco access of its own (see this file's class doc — no
 * TestBed at all), so the caller resolves the string first (`SheetShellComponent.onExport`, via
 * the injected `TranslocoService`) and passes it in; the English default here only covers a
 * caller that doesn't (there is exactly one real caller today, and it always passes one). */
export async function deliverHeroBundle(
  blob: Blob,
  fileName: string,
  description = 'Herokeep character',
): Promise<HeroDeliveryOutcome> {
  const showSaveFilePicker = (window as unknown as WindowWithSaveFilePicker).showSaveFilePicker;
  if (typeof showSaveFilePicker === 'function') {
    try {
      const handle = await showSaveFilePicker({
        suggestedName: fileName,
        types: [{ description, accept: { 'application/zip': ['.hero'] } }],
      });
      const writable = await handle.createWritable();
      await writable.write(blob);
      await writable.close();
      return 'saved';
    } catch (err) {
      if (isUserAbort(err)) return 'cancelled';
      // Fall through to the share rung below.
    }
  }

  if (typeof navigator.share === 'function') {
    const file = new File([blob], fileName, { type: blob.type });
    const canShareFiles =
      typeof navigator.canShare === 'function' && navigator.canShare({ files: [file] });
    if (canShareFiles) {
      try {
        await navigator.share({ files: [file] });
        return 'shared';
      } catch (err) {
        if (isUserAbort(err)) return 'cancelled';
        // Fall through to the download fallback below.
      }
    }
  }

  const url = URL.createObjectURL(blob);
  try {
    const anchor = document.createElement('a');
    anchor.href = url;
    anchor.download = fileName;
    anchor.rel = 'noopener';
    anchor.style.display = 'none';
    document.body.appendChild(anchor);
    anchor.click();
    anchor.remove();
  } finally {
    URL.revokeObjectURL(url);
  }
  return 'downloaded';
}
