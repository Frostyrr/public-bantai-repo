export function quoteDirectoryCsvCell(value: unknown) {
    const cell = String(value ?? "");
    const safe = /^'*(?:[\s\u0000-\u001f]*[=+@-]|[\t\r\n])/.test(cell) ? "'" + cell : cell;
    return '"' + safe.replaceAll('"', '""') + '"';
}
