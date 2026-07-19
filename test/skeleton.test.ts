import { skeleton, UNICODE_VERSION } from '../src/index';

describe('skeleton (UTS #39)', () => {
  it('maps Cyrillic lookalikes to their Latin prototypes', () => {
    expect(skeleton('НОТ')).toBe('HOT');
    expect(skeleton('раураl')).toBe('paypal');
  });

  it('is idempotent', () => {
    for (const input of ['НОТ', 'раураl', 'busіnеss', 'plain ascii']) {
      expect(skeleton(skeleton(input))).toBe(skeleton(input));
    }
  });

  it('makes confusable pairs compare equal', () => {
    expect(skeleton('ΗΟΤ')).toBe(skeleton('НОТ')); // Greek vs Cyrillic
    expect(skeleton('ＨＯＴ')).toBe(skeleton('HOT')); // fullwidth vs ASCII
  });

  it('does not collapse genuinely distinct words', () => {
    expect(skeleton('привет')).not.toBe('privet');
    expect(/^[\x20-\x7e]+$/.test(skeleton('привет'))).toBe(false);
  });

  it('ships a pinned Unicode version', () => {
    expect(UNICODE_VERSION).toMatch(/^\d+\.\d+\.\d+$/);
  });
});
