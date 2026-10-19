import { csvCell, fileSlug, toCsv } from './csv.js';

describe('csv', () => {
  it('quotes cells with commas, quotes or line breaks', () => {
    expect(csvCell('plain')).toBe('plain');
    expect(csvCell('Rivera, Sam')).toBe('"Rivera, Sam"');
    expect(csvCell('the "Bot"')).toBe('"the ""Bot"""');
    expect(csvCell('two\nlines')).toBe('"two\nlines"');
    expect(csvCell(null)).toBe('');
    expect(csvCell(3)).toBe('3');
  });

  it('defuses anything a spreadsheet would run as a formula', () => {
    expect(csvCell('=HYPERLINK("http://evil.example","Click")')).toBe('"\'=HYPERLINK(""http://evil.example"",""Click"")"');
    expect(csvCell('+1+1')).toBe("'+1+1");
    expect(csvCell('-2')).toBe("'-2");
    expect(csvCell('@SUM(A1)')).toBe("'@SUM(A1)");
    expect(csvCell('\tcmd')).toBe("'\tcmd");
    // numbers we write ourselves are left alone
    expect(csvCell(-2)).toBe('-2');
  });

  it('builds a document Excel reads as UTF-8', () => {
    const doc = toCsv([
      ['Name', 'Status'],
      ['Zoë', 'Going'],
    ]);
    expect(doc.startsWith('﻿')).toBe(true);
    expect(doc).toBe('﻿Name,Status\r\nZoë,Going\r\n');
  });

  it('makes file names from titles', () => {
    expect(fileSlug('Robot Wars: Viewing!')).toBe('robot-wars-viewing');
    expect(fileSlug('Amélie (2001)')).toBe('amelie-2001');
    expect(fileSlug('!!!')).toBe('event');
  });
});
