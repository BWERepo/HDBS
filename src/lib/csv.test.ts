import { describe, it, expect } from "vitest";
import { parseCsv, toCsv } from "./csv";

describe("parseCsv", () => {
  it("parses a simple comma-separated document", () => {
    expect(parseCsv("a,b,c\n1,2,3\n")).toEqual([
      ["a", "b", "c"],
      ["1", "2", "3"],
    ]);
  });

  it("handles a quoted field containing a comma", () => {
    expect(parseCsv('id,desc\n1,"Big personality, compact size"\n')).toEqual([
      ["id", "desc"],
      ["1", "Big personality, compact size"],
    ]);
  });

  it("handles a doubled quote as an escaped literal quote", () => {
    expect(parseCsv('id,name\n1,"She said ""hi"""\n')).toEqual([
      ["id", "name"],
      ["1", 'She said "hi"'],
    ]);
  });

  it("handles an embedded newline inside a quoted field", () => {
    expect(parseCsv('id,desc\n1,"line one\nline two"\n')).toEqual([
      ["id", "desc"],
      ["1", "line one\nline two"],
    ]);
  });

  it("handles CRLF line endings", () => {
    expect(parseCsv("a,b\r\n1,2\r\n")).toEqual([
      ["a", "b"],
      ["1", "2"],
    ]);
  });

  it("handles a final row with no trailing newline", () => {
    expect(parseCsv("a,b\n1,2")).toEqual([
      ["a", "b"],
      ["1", "2"],
    ]);
  });
});

describe("toCsv", () => {
  it("quotes a field containing a comma, quote, or newline", () => {
    const csv = toCsv([["a,b", 'say "hi"', "line1\nline2"]]);
    expect(csv).toBe('"a,b","say ""hi""","line1\nline2"\r\n');
  });

  it("round-trips through parseCsv", () => {
    const original = [
      ["id", "desc"],
      ["1", "Has, a comma and a \"quote\""],
    ];
    expect(parseCsv(toCsv(original))).toEqual(original);
  });
});
