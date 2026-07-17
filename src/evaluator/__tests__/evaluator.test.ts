import { describe, expect, it } from 'vitest';
import type { Card } from '../../engine/types';
import { PokersolverEvaluator } from '../pokersolverAdapter';

const evaluator = new PokersolverEvaluator();

function solve(cards: Card[]) {
  return evaluator.evaluate(cards);
}

describe('PokersolverEvaluator golden hands', () => {
  it('royal flush', () => {
    const r = solve(['Ah', 'Kh', 'Qh', 'Jh', 'Th', '2c', '3d']);
    expect(r.name).toBe('Straight Flush');
    expect(r.cards).toEqual(expect.arrayContaining(['Ah', 'Kh', 'Qh', 'Jh', 'Th']));
  });

  it('steel wheel (5-high straight flush)', () => {
    const r = solve(['Ah', '2h', '3h', '4h', '5h', '9c', '9d']);
    expect(r.name).toBe('Straight Flush');
    expect(r.cards).toHaveLength(5);
    expect(new Set(r.cards)).toEqual(new Set(['Ah', '2h', '3h', '4h', '5h']));
  });

  it('wheel straight (non-flush, low ace)', () => {
    const r = solve(['Ah', '2d', '3c', '4s', '5h', '9c', '9d']);
    expect(r.name).toBe('Straight');
    expect(new Set(r.cards)).toEqual(new Set(['Ah', '2d', '3c', '4s', '5h']));
  });

  it('four of a kind', () => {
    const r = solve(['9h', '9d', '9c', '9s', '2c', '3d', '4h']);
    expect(r.name).toBe('Four of a Kind');
  });

  it('full house picks the best trip + best pair', () => {
    const r = solve(['9h', '9d', '9c', '2s', '2c', '3d', '3h']);
    expect(r.name).toBe('Full House');
    expect(new Set(r.cards)).toEqual(new Set(['9h', '9d', '9c', '3d', '3h']));
  });

  it('flush picks the 5 highest of the suit', () => {
    const r = solve(['2h', '5h', '9h', 'Jh', 'Kh', '3d', '4c']);
    expect(r.name).toBe('Flush');
    expect(new Set(r.cards)).toEqual(new Set(['2h', '5h', '9h', 'Jh', 'Kh']));
  });

  it('two pair vs one pair', () => {
    const r = solve(['Ah', 'Ad', 'Kc', 'Kd', '2s', '3c', '4h']);
    expect(r.name).toBe('Two Pair');
  });

  it('high card', () => {
    const r = solve(['2h', '5d', '9c', 'Js', 'Kc', '3d', '7h']);
    expect(r.name).toBe('High Card');
  });

  it('board-plays chop: both players use all 5 board cards', () => {
    const board: Card[] = ['Ah', 'Kh', 'Qh', 'Jh', 'Th'];
    const p1 = solve(['2c', '3d', ...board]);
    const p2 = solve(['4s', '5c', ...board]);
    const winners = evaluator.winners([p1, p2]);
    expect(winners).toHaveLength(2);
    expect(winners[0]!.descr).toBe(p1.descr);
    expect(winners[1]!.descr).toBe(p2.descr);
  });

  it('non-chop: clear winner is the only entry in winners()', () => {
    const p1 = solve(['Ah', 'Ad', 'Ac', 'As', '3c', '4h', '9d']);
    const p2 = solve(['2h', '2d', 'Kc', 'Qs', '3c', '4h', '9d']);
    const winners = evaluator.winners([p1, p2]);
    expect(winners).toHaveLength(1);
    expect(winners[0]!.name).toBe('Four of a Kind');
  });

  it('rejects fewer than 5 cards', () => {
    expect(() => evaluator.evaluate(['Ah', 'Kh', 'Qh', 'Jh'])).toThrow();
  });

  it('rejects more than 7 cards', () => {
    expect(() =>
      evaluator.evaluate(['Ah', 'Kh', 'Qh', 'Jh', 'Th', '9h', '8h', '7h']),
    ).toThrow();
  });
});
