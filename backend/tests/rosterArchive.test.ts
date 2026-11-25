import { test } from "node:test";
import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { validateRosterArchive } from "../../frontend/src/utils/validateRosterArchive";

const requireFrontend = createRequire(new URL("../../frontend/package.json", import.meta.url));
const { zipSync, strToU8 } = requireFrontend("fflate") as {
  zipSync: (files: Record<string, Uint8Array>) => Uint8Array;
  strToU8: (value: string) => Uint8Array;
};
const buffer = (zip: Uint8Array) => zip.slice().buffer as ArrayBuffer;
const validFiles = {
  "[Content_Types].xml": strToU8("<Types/>"),
  "xl/workbook.xml": strToU8("<workbook/>"),
};

test("XLSX validation accepts bounded workbook archives", () => {
  assert.ok(validateRosterArchive(buffer(zipSync(validFiles))).length > 0);
});
test("XLSX validation rejects expanded payloads, external links and malformed files", () => {
  assert.throws(() => validateRosterArchive(buffer(zipSync({
    ...validFiles, "xl/worksheets/sheet1.xml": new Uint8Array(4_000_001),
  }))), /limit/);
  assert.throws(() => validateRosterArchive(buffer(zipSync({
    ...validFiles, "xl/externalLinks/link.xml": strToU8("<externalLink/>"),
  }))), /unsupported/);
  assert.throws(() => validateRosterArchive(new ArrayBuffer(4)), /valid XLSX/);
  assert.throws(() => validateRosterArchive(buffer(zipSync({ "xl/workbook.xml": strToU8("<workbook/>") }))), /incomplete/);
});
