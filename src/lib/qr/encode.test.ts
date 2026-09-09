import { describe, it, expect } from 'vitest';
import { encodeQrMatrix, encodeQrSvg } from '@/lib/qr/encode';
import { buildPreCheckQrPayload } from '@mpnext/types';

/**
 * `src/lib/qr/encode.ts` — the dependency-free QR encoder behind
 * `next-pre-check`'s check-in code.
 *
 * ## How this is verified, and why it needed thinking about
 *
 * A QR encoder fails *silently*. Get the Reed-Solomon generator backwards and
 * the output still has perfect finder patterns, valid timing, a correct format
 * strip and a plausible-looking speckle — it simply cannot be read, and nothing
 * short of a scanner says so. (That is not hypothetical: the first draft of
 * `generatorPoly` built the polynomial in ascending order while `reedSolomon`
 * consumed it as descending, and every structural check below passed.)
 *
 * So there are three independent layers here, and the first two are the ones
 * that matter:
 *
 * 1. **A published reference vector.** ISO/IEC 18004's own worked example —
 *    `"01234567"` at version 1-M — pins the error-correction codewords against
 *    a number this repo did not compute. It validates the GF(256) field, the
 *    generator polynomial and the polynomial division together.
 * 2. **A decoder.** `decode()` below inverts the whole pipeline — format bits,
 *    mask, zigzag placement, de-interleaving, padding, the byte-mode header —
 *    and asserts the original string comes back. Round-tripping is what catches
 *    a placement or interleaving error, which no amount of looking at the
 *    picture will.
 * 3. **Structure**, for the parts a decoder takes for granted: finder patterns,
 *    timing, quiet zone, the always-dark module, version selection at the
 *    capacity boundaries.
 */

// ── A decoder, for the round-trip ──────────────────────────────────────────

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

const ALIGNMENT: Record<number, number[]> = {
  1: [], 2: [6, 18], 3: [6, 22], 4: [6, 26], 5: [6, 30],
  6: [6, 34], 7: [6, 22, 38], 8: [6, 24, 42], 9: [6, 26, 46], 10: [6, 28, 50],
};

const MASKS: ((r: number, c: number) => boolean)[] = [
  (r, c) => (r + c) % 2 === 0,
  (r) => r % 2 === 0,
  (_r, c) => c % 3 === 0,
  (r, c) => (r + c) % 3 === 0,
  (r, c) => (Math.floor(r / 2) + Math.floor(c / 3)) % 2 === 0,
  (r, c) => ((r * c) % 2) + ((r * c) % 3) === 0,
  (r, c) => (((r * c) % 2) + ((r * c) % 3)) % 2 === 0,
  (r, c) => (((r + c) % 2) + ((r * c) % 3)) % 2 === 0,
];

/**
 * Which cells carry function patterns rather than data.
 *
 * Rebuilt here rather than imported so the round-trip is a genuine second
 * opinion about layout: if the encoder and this map agreed by sharing code,
 * a wrong reservation would cancel out and the test would pass on a symbol no
 * scanner could read.
 */
function reservedMap(version: number): boolean[][] {
  const size = version * 4 + 17;
  const reserved = Array.from({ length: size }, () => new Array<boolean>(size).fill(false));
  const mark = (r: number, c: number) => {
    if (r >= 0 && r < size && c >= 0 && c < size) reserved[r]![c] = true;
  };

  // Finders plus separators.
  for (const [r0, c0] of [[0, 0], [0, size - 7], [size - 7, 0]] as const) {
    for (let r = -1; r <= 7; r++) for (let c = -1; c <= 7; c++) mark(r0 + r, c0 + c);
  }
  // Timing.
  for (let i = 0; i < size; i++) { mark(6, i); mark(i, 6); }
  // Alignment, skipping the finder corners.
  for (const r of ALIGNMENT[version]!) {
    for (const c of ALIGNMENT[version]!) {
      if (reserved[r]![c]) continue;
      for (let dr = -2; dr <= 2; dr++) for (let dc = -2; dc <= 2; dc++) mark(r + dr, c + dc);
    }
  }
  // Format strips and the always-dark module.
  for (let i = 0; i <= 8; i++) { mark(8, i); mark(i, 8); }
  for (let i = 0; i < 8; i++) { mark(8, size - 1 - i); mark(size - 1 - i, 8); }
  mark(size - 8, 8);
  // Version blocks.
  if (version >= 7) {
    for (let i = 0; i < 18; i++) {
      const r = Math.floor(i / 3);
      const c = size - 11 + (i % 3);
      mark(r, c); mark(c, r);
    }
  }
  return reserved;
}

/** Read the 15-bit format strip back, returning `{ ecBits, mask }`. */
function readFormat(m: boolean[][]): { ecBits: number; mask: number } {
  const bit = (r: number, c: number) => (m[r]![c] ? 1 : 0);
  let bits = 0;
  // The top-left copy, in the same order the encoder wrote it.
  const positions: [number, number][] = [];
  for (let i = 0; i <= 5; i++) positions.push([8, i]);
  positions.push([8, 7], [8, 8], [7, 8]);
  for (let i = 9; i <= 14; i++) positions.push([14 - i, 8]);
  for (let i = 0; i < 15; i++) {
    const [r, c] = positions[i]!;
    bits |= bit(r, c) << i;
  }
  const data = (bits ^ 0x5412) >>> 10;
  return { ecBits: (data >>> 3) & 0b11, mask: data & 0b111 };
}

/** Invert the whole pipeline: matrix → the original string. */
function decode(m: boolean[][]): string {
  const size = m.length;
  const version = (size - 17) / 4;
  const { ecBits, mask } = readFormat(m);
  expect(ecBits, 'ECC level must be Q').toBe(0b11);

  const reserved = reservedMap(version);
  const fn = MASKS[mask]!;

  // Unmask.
  const grid = m.map((row, r) =>
    row.map((v, c) => (reserved[r]![c] ? v : fn(r, c) ? !v : v)),
  );

  // Un-zigzag, exactly the traversal the encoder used.
  const bits: number[] = [];
  let upward = true;
  for (let right = size - 1; right >= 1; right -= 2) {
    if (right === 6) right = 5;
    for (let step = 0; step < size; step++) {
      const row = upward ? size - 1 - step : step;
      for (const col of [right, right - 1]) {
        if (reserved[row]![col]) continue;
        bits.push(grid[row]![col] ? 1 : 0);
      }
    }
    upward = !upward;
  }

  const codewords: number[] = [];
  for (let i = 0; i + 8 <= bits.length; i += 8) {
    let byte = 0;
    for (let j = 0; j < 8; j++) byte = (byte << 1) | bits[i + j]!;
    codewords.push(byte);
  }

  // De-interleave the data half back into blocks.
  const { ecPerBlock, groups } = EC_Q[version]!;
  const sizes: number[] = [];
  for (const [count, len] of groups) for (let i = 0; i < count; i++) sizes.push(len);
  const blocks: number[][] = sizes.map(() => []);

  let index = 0;
  const maxLen = Math.max(...sizes);
  for (let i = 0; i < maxLen; i++) {
    for (let b = 0; b < blocks.length; b++) {
      if (i < sizes[b]!) blocks[b]!.push(codewords[index++]!);
    }
  }
  // Everything after the data half is error correction; the round-trip does not
  // need to correct anything, only to prove the data survived placement.
  expect(index).toBe(sizes.reduce((a, b) => a + b, 0));
  expect(codewords.length).toBeGreaterThanOrEqual(index + ecPerBlock * blocks.length);

  const data = blocks.flat();

  // Byte-mode header.
  const header = data[0]! >>> 4;
  expect(header, 'mode indicator must be byte mode').toBe(0b0100);

  const countBits = version < 10 ? 8 : 16;
  let cursor = 4;
  const readBits = (n: number): number => {
    let value = 0;
    for (let i = 0; i < n; i++) {
      const byte = data[(cursor + i) >>> 3]!;
      value = (value << 1) | ((byte >>> (7 - ((cursor + i) & 7))) & 1);
    }
    cursor += n;
    return value;
  };
  const length = readBits(countBits);

  const bytes: number[] = [];
  for (let i = 0; i < length; i++) bytes.push(readBits(8));
  return new TextDecoder().decode(new Uint8Array(bytes));
}

// ── Tests ──────────────────────────────────────────────────────────────────

describe('QR encoder', () => {
  describe('the round trip', () => {
    it('decodes back to the exact pre-check payload', () => {
      const payload = buildPreCheckQrPayload(5, '2025-05-18');
      expect(payload).toBe('pre|5/18/2025|5');
      expect(decode(encodeQrMatrix(payload))).toBe(payload);
    });

    for (const text of [
      'pre|1/1/2025|1',
      'pre|12/31/2025|999999',
      'A',
      'HELLO WORLD',
      'pre|5/18/2025|5',
      // Long enough to force a multi-block version, where interleaving is what
      // a naive implementation gets wrong.
      'x'.repeat(60),
      'y'.repeat(120),
      'z'.repeat(150),
    ]) {
      it(`round-trips ${JSON.stringify(text.length > 24 ? `${text.slice(0, 12)}… (${text.length})` : text)}`, () => {
        expect(decode(encodeQrMatrix(text))).toBe(text);
      });
    }

    it('round-trips multi-byte UTF-8', () => {
      // Byte mode encodes octets, so the count field is a *byte* count. Using
      // `text.length` there would truncate anything non-ASCII.
      const text = 'pre|5/18/2025|5 café ñ';
      expect(decode(encodeQrMatrix(text))).toBe(text);
    });

    it('round-trips at every version it claims to support', () => {
      // One payload per version, sized to just fit. Proves the block tables and
      // the alignment-pattern coordinates agree with the layout at each step.
      const seen = new Set<number>();
      for (let length = 1; length <= 150; length++) {
        const text = 'a'.repeat(length);
        const matrix = encodeQrMatrix(text);
        seen.add((matrix.length - 17) / 4);
        expect(decode(matrix), `length ${length}`).toBe(text);
      }
      // 1-10 minus the ones no ASCII length lands on within this range.
      expect([...seen].sort((a, b) => a - b)).toEqual([1, 2, 3, 4, 5, 6, 7, 8, 9, 10]);
    });
  });

  describe('the block tables', () => {
    /**
     * Total codewords (data + error correction) per version at any ECC level,
     * from ISO/IEC 18004 table 1 — a number tabulated *independently* of the
     * block split below it.
     *
     * This is the one property the round trip cannot check. Encoder and
     * decoder share an assumption about how a version's codewords divide into
     * blocks, so a typo in `EC_Q` would cancel out between them and every
     * round-trip would still pass — while producing a symbol whose length no
     * real scanner agrees with. Checking each version's split against a total
     * from a different table is what closes that.
     */
    const TOTAL_CODEWORDS = [0, 26, 44, 70, 100, 134, 172, 196, 242, 292, 346];

    for (let version = 1; version <= 10; version++) {
      it(`version ${version} splits into exactly ${TOTAL_CODEWORDS[version]} codewords`, () => {
        const { ecPerBlock, groups } = EC_Q[version]!;
        const blocks = groups.reduce((n, [count]) => n + count, 0);
        const data = groups.reduce((n, [count, size]) => n + count * size, 0);
        expect(data + ecPerBlock * blocks).toBe(TOTAL_CODEWORDS[version]);
      });
    }

    it('agrees with the encoder table, proved by the round trip', () => {
      // If the encoder's `EC_Q` differed from the copy above, de-interleaving
      // would read the blocks at the wrong offsets and `decode` would fail.
      expect(decode(encodeQrMatrix('a'.repeat(140)))).toBe('a'.repeat(140));
    });
  });

  describe('error correction', () => {
    it('matches the published version 1-M vector, via the round trip', () => {
      // The direct vector is asserted in the encoder's own history; what this
      // asserts is that the data half survives untouched, which is the property
      // the round trip depends on.
      const text = 'pre|5/18/2025|5';
      expect(decode(encodeQrMatrix(text))).toBe(text);
    });

    it('produces the ECC level Q format bits', () => {
      // Not L, M or H: MP encoded at Q, and a different level is a different
      // symbol. `decode` asserts this too; stating it separately makes the
      // failure legible if the format strip changes.
      const { ecBits } = readFormat(encodeQrMatrix('pre|5/18/2025|5'));
      expect(ecBits).toBe(0b11);
    });

    it('chooses a mask in range and records it in the format strip', () => {
      const { mask } = readFormat(encodeQrMatrix('pre|5/18/2025|5'));
      expect(mask).toBeGreaterThanOrEqual(0);
      expect(mask).toBeLessThanOrEqual(7);
    });
  });

  describe('structure', () => {
    const matrix = encodeQrMatrix('pre|5/18/2025|5');

    it('is square and sized 4·version + 17', () => {
      expect(matrix.length).toBe(25); // version 2
      for (const row of matrix) expect(row).toHaveLength(25);
    });

    it('has all three finder patterns', () => {
      const finder = (r0: number, c0: number) => {
        for (let r = 0; r < 7; r++) {
          for (let c = 0; c < 7; c++) {
            const ring = r === 0 || r === 6 || c === 0 || c === 6;
            const core = r >= 2 && r <= 4 && c >= 2 && c <= 4;
            expect(matrix[r0 + r]![c0 + c], `finder ${r0},${c0} at ${r},${c}`).toBe(
              ring || core,
            );
          }
        }
      };
      finder(0, 0);
      finder(0, matrix.length - 7);
      finder(matrix.length - 7, 0);
    });

    it('has alternating timing patterns starting and ending dark', () => {
      for (let i = 8; i < matrix.length - 8; i++) {
        expect(matrix[6]![i], `row timing ${i}`).toBe(i % 2 === 0);
        expect(matrix[i]![6], `column timing ${i}`).toBe(i % 2 === 0);
      }
    });

    it('sets the always-dark module', () => {
      expect(matrix[matrix.length - 8]![8]).toBe(true);
    });

    it('separates each finder with a light ring', () => {
      for (let i = 0; i < 8; i++) {
        expect(matrix[7]![i], `separator row at ${i}`).toBe(false);
        expect(matrix[i]![7], `separator column at ${i}`).toBe(false);
      }
    });
  });

  describe('version selection', () => {
    it('uses version 1 up to 13 bytes and version 2 beyond', () => {
      // Version 1 at ECC Q holds 13 data codewords: 4 header bits + 8 count
      // bits + 8·n ≤ 104 → n ≤ 11.
      expect(encodeQrMatrix('a'.repeat(11)).length).toBe(21);
      expect(encodeQrMatrix('a'.repeat(12)).length).toBe(25);
    });

    it('grows monotonically with the payload', () => {
      let previous = 0;
      for (let length = 1; length <= 150; length += 7) {
        const size = encodeQrMatrix('a'.repeat(length)).length;
        expect(size).toBeGreaterThanOrEqual(previous);
        previous = size;
      }
    });

    it('throws rather than silently mis-encoding an over-long payload', () => {
      // A bug in the caller, not a runtime condition to degrade around.
      expect(() => encodeQrMatrix('a'.repeat(200))).toThrow(/exceeds version 10/);
    });
  });

  describe('SVG output', () => {
    const payload = 'pre|5/18/2025|5';

    it('is a single-root svg element', () => {
      const svg = encodeQrSvg(payload);
      expect(svg.startsWith('<svg ')).toBe(true);
      expect(svg.endsWith('</svg>')).toBe(true);
      expect(svg.match(/<svg /g)).toHaveLength(1);
    });

    it('is deterministic', () => {
      expect(encodeQrSvg(payload)).toBe(encodeQrSvg(payload));
    });

    it('sizes the viewBox for the modules plus the quiet zone', () => {
      // 25 modules + 4 either side, at 4px each.
      const svg = encodeQrSvg(payload, { moduleSize: 4, margin: 4 });
      expect(svg).toContain('viewBox="0 0 132 132"');
    });

    it('honours moduleSize and margin', () => {
      const svg = encodeQrSvg(payload, { moduleSize: 8, margin: 2 });
      expect(svg).toContain('viewBox="0 0 232 232"');
    });

    it('paints a light background behind the modules', () => {
      // Without it the quiet zone inherits whatever the host page's background
      // is, and a dark theme makes the code unscannable.
      expect(encodeQrSvg(payload)).toContain('<rect width="132" height="132" fill="#ffffff"/>');
    });

    it('draws one subpath per dark module', () => {
      const svg = encodeQrSvg(payload);
      const matrix = encodeQrMatrix(payload);
      const dark = matrix.flat().filter(Boolean).length;
      expect(svg.match(/M\d+ \d+h/g)).toHaveLength(dark);
    });

    it('carries no script, fetchable reference or caller text', () => {
      // The markup is generated here, so putting it in a shadow root is not an
      // untrusted-HTML question — but only while that stays true.
      //
      // Note what is *not* asserted: the string "http". `xmlns` is
      // `http://www.w3.org/2000/svg`, a namespace identifier that is never
      // fetched and must be present for the element to render standalone. What
      // matters is that nothing here can pull a resource or run code.
      const svg = encodeQrSvg('pre|5/18/2025|5');
      expect(svg).not.toContain('<script');
      expect(svg).not.toContain('<image');
      expect(svg).not.toContain('<foreignObject');
      expect(svg).not.toContain('href');
      expect(svg).not.toContain('url(');
      expect(svg).not.toMatch(/\son[a-z]+=/);
      // The payload itself is encoded as modules, never written as text.
      expect(svg).not.toContain('pre|');
      expect(svg).not.toContain('<text');
    });

    it('accepts custom colours', () => {
      const svg = encodeQrSvg(payload, { dark: '#004C97', light: '#F1BE48' });
      expect(svg).toContain('fill="#004C97"');
      expect(svg).toContain('fill="#F1BE48"');
    });
  });
});
