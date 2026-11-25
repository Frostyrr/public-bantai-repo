import { strToU8, zipSync } from "fflate";
import { parseDirectoryCsv, restoreDirectoryCsvCell } from "./directorySpreadsheet";

export type ExportFormat = "xlsx" | "csv";

// XML 1.0 excludes these control characters.
// eslint-disable-next-line no-control-regex
const xml = (text: string) => text.replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f\ufffe\uffff]/gu, "")
  .replace(/[&<>]/g, char => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;" })[char]!);

function columnName(index: number): string {
  return index < 26 ? String.fromCharCode(65 + index) : columnName(Math.floor(index / 26) - 1) + columnName(index % 26);
}

export async function downloadSpreadsheet(blob: Blob, filename: string, format: ExportFormat, collection = false) {
  let file = blob;
  if (format === "xlsx") {
    const rows = parseDirectoryCsv(await blob.text());
    const headers = rows[0] ?? [];
    const columns = headers.map((header, index) => {
      const width = Math.min(42, Math.max(14, header.length + 3, ...rows.slice(1, 201).map(row => (row[index]?.length ?? 0) + 2)));
      return `<col min="${index + 1}" max="${index + 1}" width="${width}" customWidth="1"/>`;
    }).join("");
    const sheetRows = rows.map((row, index) => `<row r="${index + 1}"${index === 0 ? ' ht="26" customHeight="1"' : ""}>${row.map((raw, column) => {
      const ref = columnName(column) + (index + 1);
      const value = restoreDirectoryCsvCell(raw);
      const money = collection && column >= headers.length - 4 && /^(Assessed Dues|Amount Paid|Outstanding Balance) \([A-Z]{3}\)$/.test(headers[column]);
      if (index && money && /^-?\d{1,12}(?:\.\d{1,2})?$/.test(value)) {
        return `<c r="${ref}" s="2"><v>${value}</v></c>`;
      }
      return `<c r="${ref}" t="inlineStr" s="${index ? 3 : 1}"><is><t xml:space="preserve">${xml(value)}</t></is></c>`;
    }).join("")}</row>`).join("");
    const main = "http://schemas.openxmlformats.org/spreadsheetml/2006/main";
    const rel = "http://schemas.openxmlformats.org/officeDocument/2006/relationships";
    const packageRel = "http://schemas.openxmlformats.org/package/2006/relationships";
    const parts = {
      "[Content_Types].xml": '<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/><Override PartName="/xl/worksheets/sheet1.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/><Override PartName="/xl/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.styles+xml"/></Types>',
      "_rels/.rels": `<Relationships xmlns="${packageRel}"><Relationship Id="rId1" Type="${rel}/officeDocument" Target="xl/workbook.xml"/></Relationships>`,
      "xl/workbook.xml": `<workbook xmlns="${main}" xmlns:r="${rel}"><bookViews><workbookView/></bookViews><sheets><sheet name="${collection ? "Collection" : "Member Directory"}" sheetId="1" r:id="rId1"/></sheets></workbook>`,
      "xl/_rels/workbook.xml.rels": `<Relationships xmlns="${packageRel}"><Relationship Id="rId1" Type="${rel}/worksheet" Target="worksheets/sheet1.xml"/><Relationship Id="rId2" Type="${rel}/styles" Target="styles.xml"/></Relationships>`,
      "xl/styles.xml": `<styleSheet xmlns="${main}">
        <fonts count="2"><font><sz val="11"/><name val="Calibri"/></font><font><b/><sz val="11"/><color rgb="FFFFFFFF"/><name val="Calibri"/></font></fonts>
        <fills count="3"><fill><patternFill patternType="none"/></fill><fill><patternFill patternType="gray125"/></fill><fill><patternFill patternType="solid"><fgColor rgb="FF243247"/><bgColor indexed="64"/></patternFill></fill></fills>
        <borders count="1"><border/></borders>
        <cellStyleXfs count="1"><xf numFmtId="0" fontId="0" fillId="0" borderId="0"/></cellStyleXfs>
        <cellXfs count="4"><xf xfId="0"/><xf xfId="0" fontId="1" fillId="2" applyFont="1" applyFill="1" applyAlignment="1"><alignment vertical="center" wrapText="1"/></xf><xf xfId="0" numFmtId="4" applyNumberFormat="1"/><xf xfId="0" applyAlignment="1"><alignment vertical="top" wrapText="1"/></xf></cellXfs>
        <cellStyles count="1"><cellStyle name="Normal" xfId="0" builtinId="0"/></cellStyles>
      </styleSheet>`,
      "xl/worksheets/sheet1.xml": `<worksheet xmlns="${main}"><sheetViews><sheetView workbookViewId="0"><pane ySplit="1" topLeftCell="A2" activePane="bottomLeft" state="frozen"/></sheetView></sheetViews><sheetFormatPr defaultRowHeight="16"/>${columns ? `<cols>${columns}</cols>` : ""}<sheetData>${sheetRows}</sheetData>${headers.length ? `<autoFilter ref="A1:${columnName(headers.length - 1)}${rows.length}"/>` : ""}</worksheet>`,
    };
    const bytes = zipSync(Object.fromEntries(Object.entries(parts).map(([path, content]) => [path, strToU8(content)])));
    file = new Blob([new Uint8Array(bytes)], { type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" });
  }
  const url = URL.createObjectURL(file);
  const link = document.createElement("a");
  link.href = url;
  link.download = `${filename}.${format}`;
  link.click();
  window.setTimeout(() => URL.revokeObjectURL(url), 1000);
}
