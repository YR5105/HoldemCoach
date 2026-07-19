/// <reference lib="webworker" />
import { gradeDecision } from '../coach/grader';
import { villainNodeCombos } from '../coach/nodeRange';
import { simulateEquity } from '../equity/monteCarlo';
import { PokersolverEvaluator } from '../evaluator/pokersolverAdapter';
import type { Action, Card } from '../engine/types';
import type { EquityRequest, EquityWorkerMessage, EquityWorkerRequest, GradeRequest } from './equityProtocol';

const evaluator = new PokersolverEvaluator();

function resolveVillainCombos(req: EquityRequest): [Card, Card][][] {
  if (req.villainRanges) return req.villainRanges;
  if (!req.state || !req.villainSeats) {
    throw new Error('EQUITY_REQ needs either villainRanges or state + villainSeats');
  }
  const dead: Card[] = [...req.heroCards, ...req.deadCards];
  return req.villainSeats.map((seat) =>
    villainNodeCombos(req.state!, seat, dead, evaluator, req.personalities?.[seat] ?? 'TAG'),
  );
}

function handleEquity(req: EquityRequest): EquityWorkerMessage {
  const { equity, ci95 } = simulateEquity(
    {
      heroCards: req.heroCards,
      board: req.board,
      villainCombos: resolveVillainCombos(req),
      deadCards: req.deadCards,
      iterations: 1000,
      seed: req.seed,
    },
    evaluator,
  );
  return { type: 'EQUITY_RES', id: req.id, equity, ci95 };
}

function handleGrade(req: GradeRequest): EquityWorkerMessage {
  const grade = gradeDecision(
    req.preActionState,
    req.heroSeat,
    req.chosenAction as Action,
    evaluator,
    req.thresholds,
    req.personalities,
  );
  return { type: 'GRADE_RES', id: req.id, grade };
}

self.onmessage = (event: MessageEvent<EquityWorkerRequest>) => {
  const req = event.data;
  let msg: EquityWorkerMessage;
  try {
    if (req.type === 'EQUITY_REQ') msg = handleEquity(req);
    else if (req.type === 'GRADE_REQ') msg = handleGrade(req);
    else return;
  } catch (err) {
    // Guard the id read too: a null/garbage payload must not crash the handler.
    msg = { type: 'EQUITY_ERR', id: (req as { id?: number } | null | undefined)?.id ?? -1, message: err instanceof Error ? err.message : String(err) };
  }
  self.postMessage(msg);
};
