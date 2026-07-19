// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { act, cleanup, render, screen } from '@testing-library/react';
import type { GradeResult, Severity } from '../../coach/graderTypes';
import { useGameStore } from '../../store/gameStore';
import { useSettingsStore } from '../../store/settingsStore';
import { FeedbackLayer, HandSummary } from '../FeedbackLayer';
import { FeedbackCard, SEVERITY_COLOR } from '../FeedbackCard';

// A graded FLOP decision so the footer includes the hand-strength bucket.
function mockGrade(severity: Severity, overrides: Partial<GradeResult> = {}): GradeResult {
  return {
    candidates: [],
    chosen: { action: 'call', evBb: 0 },
    best: { action: 'fold', evBb: 0 },
    evLossBb: severity === 'OK' ? 0 : 1.5,
    severity,
    reasonKey: 'pot_odds',
    message:
      'Folding was the better play. The price was too high to continue. That cost you about 1.5 big blinds.',
    glossary: 'pot odds',
    equity: 0.46,
    heroBucket: 'MARGINAL',
    street: 'FLOP',
    category: 'facing_bet',
    ...overrides,
  };
}

function setFeedback(grades: { grade: GradeResult; seen?: boolean }[]) {
  useGameStore.setState({
    feedback: grades.map((g, i) => ({ grade: g.grade, actionIndex: i, seen: g.seen ?? false })),
    openFeedbackIndex: null,
  });
}

function hexToRgb(hex: string): string {
  const n = parseInt(hex.slice(1), 16);
  return `rgb(${(n >> 16) & 255}, ${(n >> 8) & 255}, ${n & 255})`;
}

beforeEach(() => {
  useGameStore.setState({ feedback: [], openFeedbackIndex: null });
});

afterEach(cleanup);

describe('coach mode: instant', () => {
  it('pops the feedback card immediately with label, message and plain-English footer', async () => {
    useSettingsStore.setState({ feedbackMode: 'instant' });
    setFeedback([{ grade: mockGrade('MISTAKE') }]);

    render(<FeedbackLayer />);

    const card = await screen.findByTestId('feedback-card');
    expect(card).toBeTruthy();
    expect(card.textContent).toContain('Mistake'); // severity label
    expect(card.textContent).toContain('better play'); // message
    expect(card.textContent).toContain('wins ~46% of the time'); // footer
    expect(card.textContent).toContain('medium-strength hand'); // bucket, plain English
  });
});

describe('coach mode: subtle', () => {
  it('shows a severity-colored dot and no card', () => {
    useSettingsStore.setState({ feedbackMode: 'subtle' });
    setFeedback([{ grade: mockGrade('MISTAKE') }]);

    render(<FeedbackLayer />);

    expect(screen.queryByTestId('feedback-card')).toBeNull();
    const dot = screen.getByLabelText('Show coach feedback');
    expect(dot.style.backgroundColor).toBe(hexToRgb(SEVERITY_COLOR.MISTAKE));
  });
});

describe('coach mode: review', () => {
  it('shows nothing mid-hand but surfaces feedback in the end-of-hand summary', () => {
    useSettingsStore.setState({ feedbackMode: 'review' });
    setFeedback([{ grade: mockGrade('BLUNDER') }]);

    const { container } = render(<FeedbackLayer />);
    expect(container.innerHTML).toBe(''); // nothing during the hand
    expect(screen.queryByTestId('feedback-card')).toBeNull();

    render(<HandSummary />);
    const card = screen.getByTestId('feedback-card');
    expect(card.textContent).toContain('Blunder');
    expect(card.textContent).toContain('better play');
  });
});

describe('switching modes mid-session', () => {
  it('takes effect on the next decision without a remount', async () => {
    useSettingsStore.setState({ feedbackMode: 'subtle' });
    setFeedback([{ grade: mockGrade('INACCURACY'), seen: true }]);

    render(<FeedbackLayer />);
    expect(screen.queryByTestId('feedback-card')).toBeNull(); // subtle: dot only

    // Switch to instant and record the next graded decision.
    act(() => {
      useSettingsStore.setState({ feedbackMode: 'instant' });
      useGameStore.setState({
        feedback: [
          { grade: mockGrade('INACCURACY'), actionIndex: 0, seen: true },
          { grade: mockGrade('BLUNDER'), actionIndex: 1, seen: false },
        ],
        openFeedbackIndex: null,
      });
    });

    const card = await screen.findByTestId('feedback-card');
    expect(card.textContent).toContain('Blunder');
  });
});

describe('OK decisions', () => {
  it('render the "good decision" copy, never the mistake layout', () => {
    render(<FeedbackCard grade={mockGrade('OK')} />);
    const card = screen.getByTestId('feedback-card');
    expect(card.textContent).toContain('OK');
    expect(card.textContent).toContain('Good decision');
    expect(card.textContent).not.toContain('better play'); // no mistake message
  });
});
