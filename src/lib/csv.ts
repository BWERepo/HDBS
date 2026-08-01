// Minimal RFC 4180 CSV parse/serialize — Workers has no fgetcsv()/fputcsv() equivalent, and
// product descriptions routinely contain commas, so a naive split(",") isn't viable.

/** Parses a full CSV document into rows of raw string cells. Handles quoted fields (embedded
 *  commas, newlines, and doubled `""` as an escaped quote) and both \n and \r\n line endings. */
export function parseCsv(text: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let cell = "";
  let inQuotes = false;
  let i = 0;
  const len = text.length;

  while (i < len) {
    const ch = text[i]!;
    if (inQuotes) {
      if (ch === '"') {
        if (text[i + 1] === '"') {
          cell += '"';
          i += 2;
          continue;
        }
        inQuotes = false;
        i++;
        continue;
      }
      cell += ch;
      i++;
      continue;
    }
    if (ch === '"') {
      inQuotes = true;
      i++;
      continue;
    }
    if (ch === ",") {
      row.push(cell);
      cell = "";
      i++;
      continue;
    }
    if (ch === "\r") {
      i++;
      continue; // swallow, \n (or end of input) ends the row
    }
    if (ch === "\n") {
      row.push(cell);
      rows.push(row);
      row = [];
      cell = "";
      i++;
      continue;
    }
    cell += ch;
    i++;
  }
  // Final cell/row if the text didn't end with a newline.
  if (cell !== "" || row.length > 0) {
    row.push(cell);
    rows.push(row);
  }
  return rows;
}

function csvField(value: string): string {
  if (/[",\n\r]/.test(value)) return `"${value.replace(/"/g, '""')}"`;
  return value;
}

/** Serializes rows of cells into a CSV document (CRLF line endings, per RFC 4180). */
export function toCsv(rows: (string | number)[][]): string {
  return rows.map((row) => row.map((cell) => csvField(String(cell))).join(",")).join("\r\n") + "\r\n";
}
