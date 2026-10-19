/**
 * CSV for spreadsheets (RFC 4180), safe to open: a cell a person typed that
 * starts like a formula (=, +, -, @, or a tab/return) would run as one in
 * Excel or Sheets ("CSV injection"), so it's prefixed with a quote mark and
 * shows as text instead.
 */
export function csvCell(value: string | number | null | undefined): string {
  if (value === null || value === undefined) return '';
  let text = String(value);
  if (typeof value === 'string' && /^[=+\-@\t\r]/.test(text)) text = `'${text}`;
  return /[",\r\n]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
}

/** Rows to a CSV document. The byte-order mark makes Excel read it as UTF-8 (names with accents). */
export function toCsv(rows: (string | number | null | undefined)[][]): string {
  return '﻿' + rows.map((row) => row.map(csvCell).join(',')).join('\r\n') + '\r\n';
}

/** A file name from a title: "Robot Wars: Viewing!" -> "robot-wars-viewing". */
export function fileSlug(title: string): string {
  return (
    title
      .normalize('NFD')
      .replace(/[^\w\s-]/g, '')
      .trim()
      .toLowerCase()
      .replace(/[\s_-]+/g, '-')
      .slice(0, 60) || 'event'
  );
}
