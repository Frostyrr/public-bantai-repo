import { parse } from "csv-parse/browser/esm/sync";

const csvOptions = { bom: true, skip_empty_lines: true, max_record_size: 16000 };

export function parseDirectoryCsv(csv: string): string[][] {
  return parse(csv, csvOptions) as string[][];
}

export function parseDirectoryCsvWithRows(csv: string): { cells: string[]; sourceRow: number }[] {
  // csv-parse wraps each row when raw is enabled, which its sync types do not model.
  const records = parse(csv, { ...csvOptions, raw: true }) as unknown as { record: string[]; raw: string }[];
  const countLines = (value: string) => (value.match(/\r\n|[\r\n]/g) ?? []).length;
  let nextRow = 1;
  return records.map(({ record, raw }) => {
    // The parser attaches skipped blank lines to the following record's raw text.
    const leadingLines = raw.match(/^(?:\r\n|[\r\n])*/)?.[0] ?? "";
    const sourceRow = nextRow + countLines(leadingLines);
    nextRow += countLines(raw);
    return { cells: record, sourceRow };
  });
}

export function mapDirectoryHeaders(headers: string[], columns: {key:string;label:string;aliases:string[]}[]) {
  const normalized = headers.map(value => value.trim().toLowerCase());
  const candidates = columns.map(column => normalized.flatMap((header,index) =>
    header.endsWith(` [${column.key.replace(/^custom:/,"")}]`) ||
    [column.key,column.label,...column.aliases].some(value => value.toLowerCase() === header) ? [index] : [],
  ));
  return Object.fromEntries(columns.map((column,index) => {
    const matches = candidates[index];
    return [column.key,matches.length === 1 && candidates.filter(values => values.includes(matches[0])).length === 1 ? matches[0] : -1];
  }));
}

export function restoreDirectoryCsvCell(value: string) {
  // Match the CSV exporter’s spreadsheet-formula escape.
  // eslint-disable-next-line no-control-regex
  return /^'+(?:[\s\u0000-\u001f]*[=+@-]|[\t\r\n])/.test(value) ? value.slice(1) : value;
}

// Suggest the common student roster layout only when several rows corroborate it.
// The officer still confirms the source columns.
export function suggestHeaderlessStudentColumns(records: string[][]): Record<string, number> {
  const sample = records.slice(0, 5);
  if (sample.length < 2 || !sample.every(row => row.length === 5)) return {};

  const matching = (pattern: RegExp) => sample[0].flatMap((_, index) =>
    sample.every(row => pattern.test(row[index].trim())) ? [index] : []);
  const names = matching(/^[^,]+,\s*\S/);
  const ids = matching(/^\d{3}-\d{5}$/);
  const years = matching(/^[1-9]$/);
  if (names.length !== 1 || ids.length !== 1 || years.length !== 1) return {};

  // College and program have similar text values. Suggest their usual relative
  // order and show both samples so the officer can verify the mapping.
  const [college, program] = [0, 1, 2, 3, 4].filter(index => ![names[0], ids[0], years[0]].includes(index));
  if (!sample.every(row => row[college].trim() && row[program].trim())) return {};
  return { display_name: names[0], "custom:student_id": ids[0], "custom:college": college,
    "custom:program": program, "custom:year_level": years[0] };
}

const paymentHeaders = new Set([
  "payment status", "amount paid", "total paid", "paid amount", "paid before bantai",
  "payment amount", "payment date", "payment reference", "amount due", "total due",
  "balance", "remaining balance", "outstanding balance", "outstanding amount",
  "receipt number", "receipt no", "receipt reference",
]);

export function isPaymentImportHeader(header: string): boolean {
  return paymentHeaders.has(header.trim().toLowerCase().replace(/[^a-z0-9]+/g, " ").trim());
}
