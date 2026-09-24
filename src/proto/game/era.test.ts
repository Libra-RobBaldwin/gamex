import { expect, test } from 'vitest';
import { gameYear, onYearChange, setGameYear } from './era';

test('one year, and listeners hear each change once', () => {
  const seen: number[] = [];
  const off = onYearChange((y) => seen.push(y));
  const start = gameYear();
  setGameYear(1965.4);
  setGameYear(1965);
  expect(gameYear()).toBe(1965);
  off();
  setGameYear(start);
  expect(seen).toEqual([1965]);
});
