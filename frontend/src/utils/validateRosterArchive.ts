import { Unzip, UnzipInflate, zipSync } from "fflate";

export function validateRosterArchive(buffer: ArrayBuffer) {
    let entries = 0;
    let total = 0;
    let pending = 0;
    const files: Record<string, Uint8Array> = {};
    const archive = new Unzip(entry => {
      entries++;
      if (entries > 100 || (entry.originalSize ?? 0) > 4_000_000 ||
          !/^(?:\[Content_Types\]\.xml|_rels\/|docProps\/|xl\/)/.test(entry.name) ||
          entry.name.includes("..") || /vbaProject|externalLinks/i.test(entry.name)) {
        throw new Error("The workbook contains unsupported entries or exceeds import limits.");
      }
      pending++;
      const chunks: Uint8Array[] = [];
      let size = 0;
      entry.ondata = (error, chunk, final) => {
        if (error) throw error;
        size += chunk.length;
        total += chunk.length;
        if (size > 4_000_000 || total > 8_000_000) throw new Error("The expanded workbook exceeds the 8 MB import limit.");
        chunks.push(chunk);
        if (final) {
          const data = new Uint8Array(size);
          let offset = 0;
          for (const part of chunks) { data.set(part, offset); offset += part.length; }
          files[entry.name] = data;
          pending--;
        }
      };
      entry.start();
    });
    archive.register(UnzipInflate);
    const input = new Uint8Array(buffer);
    if (input.length > 500_000 || input[0] !== 80 || input[1] !== 75) throw new Error("Choose a valid XLSX workbook up to 500 KB.");
    for (let offset = 0; offset < input.length; offset += 1024) {
      archive.push(input.subarray(offset, offset + 1024), offset + 1024 >= input.length);
    }
    if (pending || !files["xl/workbook.xml"] || !files["[Content_Types].xml"]) throw new Error("The workbook is incomplete.");
    // Rebuild from validated data so later parsing uses verified entry sizes.
    const validated = zipSync(files, { level: 0 });
    return validated;
}
