/**
 * A QR encoder, in about 400 lines, with no dependency.
 *
 * Written for `next-pre-check` (C78), whose check-in code carries the payload
 * `pre|M/d/yyyy|householdId` at ECC level Q — the exact string and level MP's
 * own widget server encoded (`EventsApiController.cs:216`).
 *
 * ## Why not a library
 *
 * CLAUDE.md's standing rule: no new npm or CDN dependency where the platform
 * can do the job, and `shared/calendar-links.ts` is the precedent — it replaced
 * `add-to-calendar-button` (438KB, ELv2-licensed, and loaded from a jsDelivr URL
 * that was not a file in the npm tarball) with four query strings and an `.ics`
 * builder. A byte-mode QR encoder is a few hundred lines of pure function over
 * a finite field, and it is fully specified by ISO/IEC 18004. Taking a
 * dependency to draw twenty-one squares by twenty-one is the trade that added
 * the `add-to-calendar-button` problem in the first place.
 *
 * ## Why server-side rather than in the SDK
 *
 * Three reasons. The SDK bundle is content-hashed and shipped to every church
 * site, so it should not grow by an encoder that one widget uses behind an
 * off-by-default attribute. The shape matches legacy, whose `GetQRCode` returned
 * the image from the API. And a pure function with no DOM is trivially testable
 * against the specification's own reference vectors, which is what the tests
 * next door do.
 *
 * ## Scope, deliberately
 *
 * **Byte mode, ECC level Q, versions 1-10.** Numeric, alphanumeric and kanji
 * modes are not implemented: byte mode encodes anything, and the alternatives
 * only ever buy capacity this caller does not need (a `pre|…` payload is 14-16
 * bytes, which fits version 1). ECC Q is fixed because that is what MP encoded
 * and a scanner reading a different level is not a compatible code. Versions
 * beyond 10 are refused rather than silently mis-encoded — `encodeQrSvg` throws
 * on an over-long payload, which is a bug in the caller, not a runtime
 * condition to degrade around.
 */

/**
 * ECC level Q block structure per version: `[ecPerBlock, blocks…]` where each
 * block entry is `[count, dataCodewords]`.
 *
 * Straight from ISO/IEC 18004 tables 13-22. Kept as data rather than derived,
 * because the standard's block splits are tabulated, not computed.
 */
const EC_Q: Record<number, { ecPerBlock: number; groups: [number, number][] }> = {
  1: { ecPerBlock: 13, groups: [[1, 13]] },
  2: { ecPerBlock: 22, groups: [[1, 22]] },
  3: { ecPerBlock: 18, groups: [[2, 17]] },
  4: { ecPerBlock: 26, groups: [[2, 24]] },
  5: { ecPerBlock: 18, groups: [[2, 15], [2, 16]] },
  6: { ecPerBlock: 24, groups: [[4, 19]] },
  7: { ecPerBlock: 18, groups: [[2, 14], [4, 15]] },
  8: { ecPerBlock: 22, groups: [[4, 18], [2, 19]] },
  9: { ecPerBlock: 20, groups: [[4, 16], [4, 17]] },
  10: { ecPerBlock: 24, groups: [[6, 19], [2, 20]] },
};

/** Alignment-pattern centre coordinates per version. */
const ALIGNMENT: Record<number, number[]> = {
  1: [],
  2: [6, 18],
  3: [6, 22],
  4: [6, 26],
  5: [6, 30],
  6: [6, 34],
  7: [6, 22, 38],
  8: [6, 24, 42],
  9: [6, 26, 46],
  10: [6, 28, 50],
};

/** ECC level Q's two-bit indicator in the format information. */
const EC_LEVEL_Q_BITS = 0b11;

/** Byte mode's four-bit mode indicator. */
const MODE_BYTE = 0b0100;

const MAX_VERSION = 10;

// ── GF(256) ────────────────────────────────────────────────────────────────

/**
 * Exponential and log tables for GF(256) with the QR primitive polynomial
 * `x^8 + x^4 + x^3 + x^2 + 1` (0x11D).
 *
 * Built once at module load: 512 entries so `gfExp[a + b]` needs no modulo.
 */
const GF_EXP = new Uint8Array(512);
const GF_LOG = new Uint8Array(256);

(() => {
  let x = 1;
  for (let i = 0; i < 255; i++) {
    GF_EXP[i] = x;
    GF_LOG[x] = i;
    x <<= 1;
    if (x & 0x100) x ^= 0x11d;
  }
  for (let i = 255; i < 512; i++) GF_EXP[i] = GF_EXP[i - 255]!;
})();

function gfMul(a: number, b: number): number {
  if (a === 0 || b === 0) return 0;
  return GF_EXP[GF_LOG[a]! + GF_LOG[b]!]!;
}

/**
 * The Reed-Solomon generator polynomial of the given degree:
 * `(x - α⁰)(x - α¹)…(x - α^(degree-1))`.
 *
 * **Descending order, leading coefficient first** — `[1, …]` — which is what
 * {@link reedSolomon} assumes when it reads `gen[i + 1]`. Getting the two ends
 * of that convention out of step produces a polynomial that is the exact
 * reverse of the right one, and therefore error-correction codewords that are
 * wrong in a way nothing structural would reveal: the code still has valid
 * finders, timing and format bits, and still scans as a *damaged* symbol that
 * no reader can correct. `encode.test.ts` pins it with the published
 * version 1-M vector for `"01234567"` for exactly that reason.
 */
function generatorPoly(degree: number): number[] {
  let poly = [1];
  for (let i = 0; i < degree; i++) {
    const next = new Array<number>(poly.length + 1).fill(0);
    for (let j = 0; j < poly.length; j++) {
      // x · poly keeps the index; α^i · poly moves one place down.
      next[j] = (next[j] as number) ^ poly[j]!;
      next[j + 1] = (next[j + 1] as number) ^ gfMul(poly[j]!, GF_EXP[i]!);
    }
    poly = next;
  }
  return poly;
}

/** `ecLen` Reed-Solomon codewords for one data block. */
function reedSolomon(data: number[], ecLen: number): number[] {
  const gen = generatorPoly(ecLen);
  const remainder = new Array<number>(ecLen).fill(0);

  for (const byte of data) {
    const factor = byte ^ (remainder[0] as number);
    remainder.shift();
    remainder.push(0);
    if (factor !== 0) {
      for (let i = 0; i < ecLen; i++) {
        remainder[i] = (remainder[i] as number) ^ gfMul(gen[i + 1]!, factor);
      }
    }
  }

  return remainder;
}

// ── Data encoding ──────────────────────────────────────────────────────────

/** Total data codewords available at ECC Q for a version. */
function dataCapacity(version: number): number {
  const spec = EC_Q[version]!;
  return spec.groups.reduce((sum, [count, size]) => sum + count * size, 0);
}

/**
 * The smallest version that holds `byteLength` bytes in byte mode at ECC Q.
 *
 * The header is 4 mode bits plus a character-count field that widens from 8 to
 * 16 bits at version 10 — which is why the loop re-checks rather than solving
 * for a version directly.
 */
function selectVersion(byteLength: number): number {
  for (let version = 1; version <= MAX_VERSION; version++) {
    const countBits = version < 10 ? 8 : 16;
    const needed = Math.ceil((4 + countBits + byteLength * 8) / 8);
    if (needed <= dataCapacity(version)) return version;
  }
  throw new Error(
    `encodeQrSvg: ${byteLength} bytes exceeds version ${MAX_VERSION} at ECC level Q.`,
  );
}

/** A growable most-significant-bit-first bit buffer. */
class BitBuffer {
  private bits: number[] = [];

  push(value: number, length: number): void {
    for (let i = length - 1; i >= 0; i--) this.bits.push((value >>> i) & 1);
  }

  get length(): number {
    return this.bits.length;
  }

  /** Pad to a byte boundary and return the bytes. */
  toBytes(): number[] {
    const bytes: number[] = [];
    for (let i = 0; i < this.bits.length; i += 8) {
      let byte = 0;
      for (let j = 0; j < 8; j++) byte = (byte << 1) | (this.bits[i + j] ?? 0);
      bytes.push(byte);
    }
    return bytes;
  }
}

/** Data codewords for `bytes` at `version`, terminated and padded. */
function buildDataCodewords(bytes: number[], version: number): number[] {
  const capacity = dataCapacity(version);
  const buffer = new BitBuffer();

  buffer.push(MODE_BYTE, 4);
  buffer.push(bytes.length, version < 10 ? 8 : 16);
  for (const byte of bytes) buffer.push(byte, 8);

  // Terminator: up to four zero bits, truncated if the buffer is nearly full.
  const capacityBits = capacity * 8;
  buffer.push(0, Math.min(4, capacityBits - buffer.length));
  // Then zeroes to the next byte boundary.
  if (buffer.length % 8 !== 0) buffer.push(0, 8 - (buffer.length % 8));

  const codewords = buffer.toBytes();
  // Pad bytes alternate 0xEC / 0x11, per the specification.
  const PAD = [0xec, 0x11];
  for (let i = 0; codewords.length < capacity; i++) codewords.push(PAD[i % 2]!);

  return codewords;
}

/**
 * Split into blocks, add error correction, and interleave.
 *
 * Interleaving is what makes a QR code tolerant of a localised smudge: a burst
 * of damage is spread across blocks rather than destroying one block's worth of
 * consecutive codewords.
 */
function buildFinalCodewords(dataCodewords: number[], version: number): number[] {
  const { ecPerBlock, groups } = EC_Q[version]!;

  const dataBlocks: number[][] = [];
  const ecBlocks: number[][] = [];
  let offset = 0;

  for (const [count, size] of groups) {
    for (let i = 0; i < count; i++) {
      const block = dataCodewords.slice(offset, offset + size);
      offset += size;
      dataBlocks.push(block);
      ecBlocks.push(reedSolomon(block, ecPerBlock));
    }
  }

  const result: number[] = [];
  const maxData = Math.max(...dataBlocks.map((b) => b.length));
  for (let i = 0; i < maxData; i++) {
    for (const block of dataBlocks) if (i < block.length) result.push(block[i]!);
  }
  for (let i = 0; i < ecPerBlock; i++) {
    for (const block of ecBlocks) result.push(block[i]!);
  }

  return result;
}

// ── The matrix ─────────────────────────────────────────────────────────────

/** `null` = not yet placed; `true` = dark. */
type Cell = boolean | null;

interface Matrix {
  size: number;
  cells: Cell[][];
  /** Function patterns and format/version areas — never masked, never data. */
  reserved: boolean[][];
}

function newMatrix(version: number): Matrix {
  const size = version * 4 + 17;
  return {
    size,
    cells: Array.from({ length: size }, () => new Array<Cell>(size).fill(null)),
    reserved: Array.from({ length: size }, () => new Array<boolean>(size).fill(false)),
  };
}

function set(m: Matrix, row: number, col: number, dark: boolean, reserve = true): void {
  m.cells[row]![col] = dark;
  if (reserve) m.reserved[row]![col] = true;
}

function placeFinder(m: Matrix, row: number, col: number): void {
  // The 7×7 finder plus its one-module separator, clipped at the edges.
  for (let r = -1; r <= 7; r++) {
    for (let c = -1; c <= 7; c++) {
      const rr = row + r;
      const cc = col + c;
      if (rr < 0 || rr >= m.size || cc < 0 || cc >= m.size) continue;
      const inRing = (r >= 0 && r <= 6 && (c === 0 || c === 6)) ||
        (c >= 0 && c <= 6 && (r === 0 || r === 6));
      const inCore = r >= 2 && r <= 4 && c >= 2 && c <= 4;
      set(m, rr, cc, inRing || inCore);
    }
  }
}

function placeAlignment(m: Matrix, version: number): void {
  const centres = ALIGNMENT[version]!;
  for (const row of centres) {
    for (const col of centres) {
      // The three finder corners have no alignment pattern.
      if (m.reserved[row]![col]) continue;
      for (let r = -2; r <= 2; r++) {
        for (let c = -2; c <= 2; c++) {
          const ring = Math.max(Math.abs(r), Math.abs(c));
          set(m, row + r, col + c, ring !== 1);
        }
      }
    }
  }
}

function placeTiming(m: Matrix): void {
  for (let i = 8; i < m.size - 8; i++) {
    const dark = i % 2 === 0;
    set(m, 6, i, dark);
    set(m, i, 6, dark);
  }
}

/** Reserve the format-information strips (written after masking). */
function reserveFormat(m: Matrix): void {
  for (let i = 0; i <= 8; i++) {
    if (i !== 6) {
      m.reserved[8]![i] = true;
      m.reserved[i]![8] = true;
    }
  }
  for (let i = 0; i < 8; i++) {
    m.reserved[8]![m.size - 1 - i] = true;
    m.reserved[m.size - 1 - i]![8] = true;
  }
  // The always-dark module below the top-left finder.
  set(m, m.size - 8, 8, true);
}

/** The 6×3 version blocks, present from version 7. */
function placeVersionInfo(m: Matrix, version: number): void {
  if (version < 7) return;

  let value = version << 12;
  for (let i = 0; i < 12; i++) {
    const shift = 17 - i;
    if ((value >>> shift) & 1) value ^= 0x1f25 << (shift - 12);
  }
  const bits = (version << 12) | (value & 0xfff);

  for (let i = 0; i < 18; i++) {
    const dark = ((bits >>> i) & 1) === 1;
    const row = Math.floor(i / 3);
    const col = m.size - 11 + (i % 3);
    set(m, row, col, dark);
    set(m, col, row, dark);
  }
}

/**
 * Lay the codewords out in the two-module-wide upward/downward zigzag.
 *
 * Column 6 is skipped throughout: it is the vertical timing pattern, and
 * forgetting it shifts every subsequent module.
 */
function placeData(m: Matrix, codewords: number[]): void {
  let bitIndex = 0;
  let upward = true;

  for (let right = m.size - 1; right >= 1; right -= 2) {
    if (right === 6) right = 5;

    for (let step = 0; step < m.size; step++) {
      const row = upward ? m.size - 1 - step : step;
      for (const col of [right, right - 1]) {
        if (m.reserved[row]![col]) continue;
        const byte = codewords[bitIndex >>> 3] ?? 0;
        const dark = ((byte >>> (7 - (bitIndex & 7))) & 1) === 1;
        m.cells[row]![col] = dark;
        bitIndex++;
      }
    }
    upward = !upward;
  }
}

/** The eight mask conditions, by pattern number. */
const MASKS: ((row: number, col: number) => boolean)[] = [
  (r, c) => (r + c) % 2 === 0,
  (r) => r % 2 === 0,
  (_r, c) => c % 3 === 0,
  (r, c) => (r + c) % 3 === 0,
  (r, c) => (Math.floor(r / 2) + Math.floor(c / 3)) % 2 === 0,
  (r, c) => ((r * c) % 2) + ((r * c) % 3) === 0,
  (r, c) => (((r * c) % 2) + ((r * c) % 3)) % 2 === 0,
  (r, c) => (((r + c) % 2) + ((r * c) % 3)) % 2 === 0,
];

function applyMask(m: Matrix, mask: number): Matrix {
  const fn = MASKS[mask]!;
  const out: Matrix = {
    size: m.size,
    cells: m.cells.map((row) => [...row]),
    reserved: m.reserved,
  };
  for (let r = 0; r < m.size; r++) {
    for (let c = 0; c < m.size; c++) {
      if (m.reserved[r]![c]) continue;
      if (fn(r, c)) out.cells[r]![c] = !(out.cells[r]![c] ?? false);
    }
  }
  return out;
}

/** ISO/IEC 18004 section 8.8.2 — the four penalty rules. */
function penalty(m: Matrix): number {
  const size = m.size;
  const at = (r: number, c: number) => m.cells[r]![c] === true;
  let score = 0;

  // Rule 1: runs of five or more identical modules in a row or column.
  for (let i = 0; i < size; i++) {
    for (const horizontal of [true, false]) {
      let run = 1;
      let previous = horizontal ? at(i, 0) : at(0, i);
      for (let j = 1; j < size; j++) {
        const current = horizontal ? at(i, j) : at(j, i);
        if (current === previous) {
          run++;
        } else {
          if (run >= 5) score += 3 + (run - 5);
          run = 1;
          previous = current;
        }
      }
      if (run >= 5) score += 3 + (run - 5);
    }
  }

  // Rule 2: every 2×2 block of one colour.
  for (let r = 0; r < size - 1; r++) {
    for (let c = 0; c < size - 1; c++) {
      const v = at(r, c);
      if (v === at(r, c + 1) && v === at(r + 1, c) && v === at(r + 1, c + 1)) {
        score += 3;
      }
    }
  }

  // Rule 3: the finder-lookalike 1:1:3:1:1 pattern with four light modules on
  // either side, in a row or a column.
  const A = [true, false, true, true, true, false, true, false, false, false, false];
  const B = [false, false, false, false, true, false, true, true, true, false, true];
  for (let i = 0; i < size; i++) {
    for (let j = 0; j + 11 <= size; j++) {
      for (const horizontal of [true, false]) {
        let matchesA = true;
        let matchesB = true;
        for (let k = 0; k < 11; k++) {
          const v = horizontal ? at(i, j + k) : at(j + k, i);
          if (v !== A[k]) matchesA = false;
          if (v !== B[k]) matchesB = false;
        }
        if (matchesA) score += 40;
        if (matchesB) score += 40;
      }
    }
  }

  // Rule 4: deviation of the dark-module proportion from 50%.
  let dark = 0;
  for (let r = 0; r < size; r++) for (let c = 0; c < size; c++) if (at(r, c)) dark++;
  const percent = (dark * 100) / (size * size);
  score += Math.floor(Math.abs(percent - 50) / 5) * 10;

  return score;
}

/** Write the 15-bit BCH format information for ECC Q and the chosen mask. */
function placeFormatInfo(m: Matrix, mask: number): void {
  const data = (EC_LEVEL_Q_BITS << 3) | mask;
  let value = data << 10;
  for (let i = 0; i < 5; i++) {
    const shift = 14 - i;
    if ((value >>> shift) & 1) value ^= 0x537 << (shift - 10);
  }
  const bits = ((data << 10) | (value & 0x3ff)) ^ 0x5412;

  const dark = (i: number) => ((bits >>> i) & 1) === 1;

  // Around the top-left finder.
  for (let i = 0; i <= 5; i++) set(m, 8, i, dark(i));
  set(m, 8, 7, dark(6));
  set(m, 8, 8, dark(7));
  set(m, 7, 8, dark(8));
  for (let i = 9; i <= 14; i++) set(m, 14 - i, 8, dark(i));

  // The duplicate copy, split between the other two corners.
  for (let i = 0; i <= 7; i++) set(m, m.size - 1 - i, 8, dark(i));
  for (let i = 8; i <= 14; i++) set(m, 8, m.size - 15 + i, dark(i));
}

// ── Public API ─────────────────────────────────────────────────────────────

export interface QrSvgOptions {
  /** Pixels per module in the SVG's own coordinate space. Default 4. */
  moduleSize?: number;
  /**
   * Quiet-zone width in modules. Default 4, which is the specification's
   * minimum — a code printed or shown with less is out of spec and some
   * scanners will refuse it.
   */
  margin?: number;
  /** Dark-module colour. Default `#000000`. */
  dark?: string;
  /** Light-module (background) colour. Default `#ffffff`. */
  light?: string;
}

/**
 * The module grid for `text` at ECC level Q.
 *
 * Exported for the tests, which check module counts and the finder patterns
 * directly rather than through the SVG's path data.
 */
export function encodeQrMatrix(text: string): boolean[][] {
  const bytes = [...new TextEncoder().encode(text)];
  const version = selectVersion(bytes.length);

  const codewords = buildFinalCodewords(buildDataCodewords(bytes, version), version);

  const base = newMatrix(version);
  placeFinder(base, 0, 0);
  placeFinder(base, 0, base.size - 7);
  placeFinder(base, base.size - 7, 0);
  placeAlignment(base, version);
  placeTiming(base);
  placeVersionInfo(base, version);
  reserveFormat(base);
  placeData(base, codewords);

  // Try all eight masks and keep the lowest-penalty one, as the specification
  // requires. Choosing a fixed mask would produce a valid but needlessly
  // hard-to-scan code.
  let best: Matrix | null = null;
  let bestScore = Infinity;
  for (let mask = 0; mask < 8; mask++) {
    const candidate = applyMask(base, mask);
    placeFormatInfo(candidate, mask);
    const score = penalty(candidate);
    if (score < bestScore) {
      bestScore = score;
      best = candidate;
    }
  }

  return best!.cells.map((row) => row.map((cell) => cell === true));
}

/**
 * Encode `text` as a self-contained `<svg>` string.
 *
 * Deterministic: the same input always produces the same output, byte for byte.
 * The dark modules are emitted as one `<path>` rather than a rect per module —
 * a version-1 code is 441 modules, and 441 elements is both larger and slower
 * to paint than one path with 441 subpaths.
 *
 * The markup is generated here, so injecting it into a shadow root is not an
 * untrusted-HTML question. It contains no script, no external reference and no
 * caller-supplied text.
 */
export function encodeQrSvg(text: string, options: QrSvgOptions = {}): string {
  const moduleSize = options.moduleSize ?? 4;
  const margin = options.margin ?? 4;
  const dark = options.dark ?? "#000000";
  const light = options.light ?? "#ffffff";

  const matrix = encodeQrMatrix(text);
  const size = matrix.length;
  const extent = (size + margin * 2) * moduleSize;

  const segments: string[] = [];
  for (let r = 0; r < size; r++) {
    for (let c = 0; c < size; c++) {
      if (!matrix[r]![c]) continue;
      const x = (c + margin) * moduleSize;
      const y = (r + margin) * moduleSize;
      segments.push(`M${x} ${y}h${moduleSize}v${moduleSize}h-${moduleSize}z`);
    }
  }

  // One literal per line and an array join — never `+` between template
  // literals. Turbopack's production minifier folds such a chain and drops
  // literal text (`.claude/references/nextjs.build-hazards.md`), and
  // `src/lib/no-template-concat.test.ts` fails the run if the pattern returns.
  return [
    `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${extent} ${extent}" width="${extent}" height="${extent}" shape-rendering="crispEdges">`,
    `<rect width="${extent}" height="${extent}" fill="${light}"/>`,
    `<path fill="${dark}" d="${segments.join("")}"/>`,
    `</svg>`,
  ].join("");
}
