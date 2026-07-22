import { test, expect, type Locator, type Page } from '@playwright/test';

/**
 * Clicks a button only if it is present, visible and enabled — checking
 * presence with count() first so we never trigger isEnabled()'s auto-wait on
 * an absent element (e.g. no "Check" button when facing a bet).
 */
async function tryClick(locator: Locator): Promise<boolean> {
  if ((await locator.count()) === 0) return false;
  const el = locator.first();
  if (!(await el.isVisible()) || !(await el.isEnabled())) return false;
  try {
    // A short timeout so an in-flight feedback modal briefly intercepting the
    // click doesn't hang the run — the loop closes the modal and retries.
    await el.click({ timeout: 2000 });
    return true;
  } catch {
    return false;
  }
}

// Fail the whole test on any uncaught page error.
function trackPageErrors(page: Page): string[] {
  const errors: string[] = [];
  page.on('pageerror', (err) => errors.push(String(err)));
  return errors;
}

async function completeOnboarding(page: Page) {
  await page.getByRole('button', { name: 'Total beginner' }).click();
  await page.getByRole('button', { name: 'Got it' }).click();
  await page.getByRole('button', { name: 'Deal me in' }).click();
  // The table is up once the pot indicator renders.
  await expect(page.getByTestId('pot')).toBeVisible({ timeout: 15_000 });
}

/** Reads the pot number and asserts it is a non-negative integer. */
async function assertPot(page: Page) {
  const text = await page.getByTestId('pot').textContent();
  if (!text) return;
  const n = Number(text.replace(/[^0-9-]/g, ''));
  expect(Number.isInteger(n), `pot "${text}" is not an integer`).toBeTruthy();
  expect(n, `pot "${text}" is negative`).toBeGreaterThanOrEqual(0);
}

/** When the win dial shows a percentage, it must be within 0–100. */
async function assertWinDial(page: Page) {
  const dial = page.getByTestId('win-percent');
  if (!(await dial.isVisible().catch(() => false))) return;
  const text = (await dial.textContent()) ?? '';
  if (!/\d/.test(text)) return; // still computing ("…")
  const pct = Number(text.replace('%', '').trim());
  expect(pct).toBeGreaterThanOrEqual(0);
  expect(pct).toBeLessThanOrEqual(100);
}

test('boots, plays three hands, and every screen renders', async ({ page }) => {
  const errors = trackPageErrors(page);

  await page.goto('/?fastbots'); // collapse bot pacing so three hands finish quickly
  await completeOnboarding(page);

  let handsCompleted = 0;
  let sawFeedbackCard = false;
  const deadline = Date.now() + 100_000;

  while (handsCompleted < 3 && Date.now() < deadline) {
    // Instant-mode feedback pops a modal that overlays the table; note it and
    // close it before anything else so action buttons are clickable again.
    const card = page.getByTestId('feedback-card');
    if (await card.isVisible().catch(() => false)) {
      sawFeedbackCard = true;
      await expect(card).toContainText(/wins ~\d+% of the time/); // plain-English footer
      await page.getByRole('button', { name: 'Close' }).click().catch(() => {});
      continue;
    }

    await assertPot(page);
    await assertWinDial(page);

    // Hand finished (or the whole match did): advance and count it.
    if (await tryClick(page.getByRole('button', { name: 'Next Hand' }))) {
      handsCompleted++;
      continue;
    }
    if (await tryClick(page.getByRole('button', { name: 'New Game' }))) {
      handsCompleted++;
      continue;
    }

    // Hero's turn: prefer Check, then Call (calling down surfaces coaching),
    // then Fold when facing a bet. If none are actionable, bots are acting.
    const acted =
      (await tryClick(page.getByRole('button', { name: 'Check' }))) ||
      (await tryClick(page.getByRole('button', { name: /^Call/ }))) ||
      (await tryClick(page.getByRole('button', { name: 'Fold' })));
    if (!acted) await page.waitForTimeout(50); // bots are acting
  }

  expect(handsCompleted, 'played at least three hands').toBeGreaterThanOrEqual(3);
  expect(sawFeedbackCard, 'a feedback card appeared in instant mode').toBe(true);

  // Every other screen renders its main heading.
  const nav = page.getByRole('navigation');

  await nav.getByRole('button', { name: 'Review' }).click();
  await expect(page.getByRole('heading', { name: 'Hand history' })).toBeVisible();

  await nav.getByRole('button', { name: 'Dashboard' }).click();
  await expect(
    page.getByText(/EV loss per 100 hands|No hands yet/).first(),
  ).toBeVisible();

  await nav.getByRole('button', { name: 'Settings' }).click();
  await expect(page.getByRole('heading', { name: 'Coach feedback' })).toBeVisible();

  expect(errors, `page errors: ${errors.join('\n')}`).toEqual([]);
});
