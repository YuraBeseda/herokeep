/**
 * The one zip writer: `fflate`'s `zipSync` over a name -> bytes map, as a `Blob`. `.hkpack` export
 * (`HkpackWriter`) and Settings' "Export all heroes" both build their archives through it. `fflate`
 * is imported lazily, so it stays out of the initial bundle.
 */
export async function zipFiles(files: Record<string, Uint8Array>): Promise<Blob> {
  const { zipSync } = await import('fflate');
  return new Blob([zipSync(files)], { type: 'application/zip' });
}
