/**
 * Text decoding for editor content and terminal output.
 *
 * Windows files and consoles are frequently not UTF-8: `cmd.exe` writes the
 * OEM code page and editors still save UTF-16 with a BOM. Decoding those bytes
 * as UTF-8 produces mojibake such as `â€™`, so every read is BOM-aware and
 * every write keeps the encoding the file already used.
 */

export type TextEncoding = 'utf8' | 'utf16le' | 'utf16be';

const UTF8_BOM = [0xef, 0xbb, 0xbf];
const UTF16LE_BOM = [0xff, 0xfe];
const UTF16BE_BOM = [0xfe, 0xff];

function startsWith(buffer: Buffer, bytes: number[]): boolean {
  return bytes.every((byte, index) => buffer[index] === byte);
}

export function hasByteOrderMark(buffer: Buffer): boolean {
  return (
    startsWith(buffer, UTF8_BOM) ||
    startsWith(buffer, UTF16LE_BOM) ||
    startsWith(buffer, UTF16BE_BOM)
  );
}

export function detectTextEncoding(buffer: Buffer): TextEncoding {
  if (startsWith(buffer, UTF16LE_BOM)) return 'utf16le';
  if (startsWith(buffer, UTF16BE_BOM)) return 'utf16be';
  return 'utf8';
}

export function decodeText(buffer: Buffer): string {
  if (startsWith(buffer, UTF16LE_BOM))
    return new TextDecoder('utf-16le').decode(buffer.subarray(2));
  if (startsWith(buffer, UTF16BE_BOM))
    return new TextDecoder('utf-16be').decode(buffer.subarray(2));
  if (startsWith(buffer, UTF8_BOM)) return new TextDecoder('utf-8').decode(buffer.subarray(3));
  return new TextDecoder('utf-8').decode(buffer);
}

export function encodeText(text: string, encoding: TextEncoding): Buffer {
  if (encoding === 'utf16le')
    return Buffer.concat([Buffer.from(UTF16LE_BOM), Buffer.from(text, 'utf16le')]);
  if (encoding === 'utf16be')
    return Buffer.concat([Buffer.from(UTF16BE_BOM), Buffer.from(text, 'utf16le').swap16()]);
  return Buffer.from(text, 'utf8');
}

const LEGACY_CONSOLE_ENCODINGS =
  process.platform === 'win32' ? ['cp850', 'cp437', 'windows-1252'] : ['windows-1252'];

/**
 * Decodes captured command output. Modern tools emit UTF-8, so that is tried
 * strictly first; legacy console output that is not valid UTF-8 falls back to a
 * single-byte Windows code page instead of becoming mojibake.
 */
export function decodeConsoleOutput(buffer: Buffer): string {
  if (buffer.length === 0) return '';
  try {
    return new TextDecoder('utf-8', { fatal: true }).decode(buffer).replace(/^\ufeff/, '');
  } catch {
    for (const encoding of LEGACY_CONSOLE_ENCODINGS) {
      try {
        return new TextDecoder(encoding).decode(buffer).replace(/\r\n/g, '\n');
      } catch {
        continue;
      }
    }
    return buffer.toString('latin1');
  }
}
