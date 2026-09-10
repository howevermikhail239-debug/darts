export type NumberSegment = 1|2|3|4|5|6|7|8|9|10|11|12|13|14|15|16|17|18|19|20;
export type Multiplier = 1|2|3;
export type DartThrow =
  | Readonly<{ kind: 'number'; segment: NumberSegment; multiplier: Multiplier }>
  | Readonly<{ kind: 'outer_bull' }>
  | Readonly<{ kind: 'bull' }>
  | Readonly<{ kind: 'miss' }>;

export const isNumberSegment = (value: number): value is NumberSegment => Number.isInteger(value) && value >= 1 && value <= 20;
export function numberThrow(segment: number, multiplier: Multiplier): DartThrow {
  if (!isNumberSegment(segment)) throw new RangeError('Сектор должен быть от 1 до 20');
  if (![1, 2, 3].includes(multiplier))
    throw new RangeError('Множитель должен быть 1, 2 или 3');
  return Object.freeze({ kind: 'number', segment, multiplier });
}
export const outerBull = (): DartThrow => Object.freeze({ kind: 'outer_bull' });
export const bull = (): DartThrow => Object.freeze({ kind: 'bull' });
export const miss = (): DartThrow => Object.freeze({ kind: 'miss' });
export const scoreOf = (dart: DartThrow): number => dart.kind === 'number' ? dart.segment * dart.multiplier : dart.kind === 'outer_bull' ? 25 : dart.kind === 'bull' ? 50 : 0;
export const notationOf = (dart: DartThrow): string => dart.kind === 'number' ? `${dart.multiplier === 1 ? 'S' : dart.multiplier === 2 ? 'D' : 'T'}${dart.segment}` : dart.kind === 'outer_bull' ? '25' : dart.kind === 'bull' ? 'Bull' : 'MISS';
export const isDouble = (dart: DartThrow): boolean => dart.kind === 'bull' || (dart.kind === 'number' && dart.multiplier === 2);
