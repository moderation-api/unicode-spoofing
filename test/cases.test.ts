import { analyze } from '../src/index';
import { CASES, type SpoofCase } from './cases.data';

/**
 * Runner for the community case registry in `cases.data.ts`.
 *
 * - `status: 'supported'`   → a normal assertion; must pass.
 * - `status: 'unsupported'` → a documented gap. It passes CI *as long as the
 *   library does not yet satisfy the case*. The moment it does, this test fails
 *   on purpose, nudging you to flip `status` to `'supported'`.
 */

/** Throws (with a readable message) if `analyze(input)` doesn't match `expect`. */
function checkExpectations(c: SpoofCase): void {
  const r = analyze(c.input, c.options);

  if (c.expect.spoofed !== undefined) {
    expect(r.spoofed, 'spoofed').toBe(c.expect.spoofed);
  }

  if (c.expect.signals) {
    for (const [signal, want] of Object.entries(c.expect.signals)) {
      expect(r.signals[signal as keyof typeof r.signals], `signal ${signal}`).toBe(want);
    }
  }

  if (c.expect.normalized !== undefined) {
    expect(r.normalized, 'normalized').toBe(c.expect.normalized);
  }

  if (c.expect.word !== undefined) {
    const words = r.words.map((w) => w.word);
    expect(words, `affected words should include ${JSON.stringify(c.expect.word)}`).toContain(
      c.expect.word,
    );
  }
}

const byCategory = new Map<string, SpoofCase[]>();
for (const c of CASES) {
  const list = byCategory.get(c.category) ?? [];
  list.push(c);
  byCategory.set(c.category, list);
}

describe('community cases', () => {
  for (const [category, cases] of byCategory) {
    describe(category, () => {
      for (const c of cases) {
        if (c.status === 'supported') {
          it(c.name, () => checkExpectations(c));
        } else {
          it(`[unsupported] ${c.name}`, () => {
            let nowSatisfied = true;
            try {
              checkExpectations(c);
            } catch {
              nowSatisfied = false;
            }
            if (nowSatisfied) {
              throw new Error(
                `Case "${c.name}" now passes. The library supports it — ` +
                  `change its status to 'supported' in test/cases.data.ts.`,
              );
            }
          });
        }
      }
    });
  }
});
