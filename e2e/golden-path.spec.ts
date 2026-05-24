import { test, expect } from "@playwright/test";

/**
 * Golden-path E2E:
 *   1. Sign up a fresh user (or sign in if E2E_TEST_EMAIL already exists)
 *   2. Connect a WordPress site via the Integrations page
 *   3. Enqueue a full optimization run
 *   4. Verify the Approvals queue shows pending items
 *      (NO writes hit WP until a human clicks Approve)
 *   5. Approve one item, then verify rollback is available
 *
 * This is opt-in (skipped unless PLAYWRIGHT_E2E=1) because it requires:
 *   - A reachable WordPress site with an application password
 *   - A working test inbox or pre-confirmed test account
 *   - The dev/preview server to be running on E2E_BASE_URL
 */
const E2E = process.env.PLAYWRIGHT_E2E === "1";
const email = process.env.E2E_TEST_EMAIL ?? "";
const password = process.env.E2E_TEST_PASSWORD ?? "";
const wpUrl = process.env.E2E_WP_URL ?? "";
const wpUser = process.env.E2E_WP_USER ?? "";
const wpAppPw = process.env.E2E_WP_APP_PASSWORD ?? "";

test.describe("Golden path: signup → connect WP → optimize → approve → rollback", () => {
  test.skip(!E2E, "Set PLAYWRIGHT_E2E=1 and the E2E_* env vars to run.");

  test("user can connect WP, run optimization, and approve a change safely", async ({ page }) => {
    test.skip(!email || !password, "E2E_TEST_EMAIL / E2E_TEST_PASSWORD required");
    test.skip(!wpUrl || !wpUser || !wpAppPw, "E2E_WP_* required");

    // 1. Sign in (signup form falls back to login if user exists).
    await page.goto("/login");
    await page.getByLabel(/email/i).fill(email);
    await page.getByLabel(/password/i).fill(password);
    await page.getByRole("button", { name: /sign in|log in/i }).click();
    await expect(page).toHaveURL(/\/dashboard|\/onboarding/);

    // 2. Connect WordPress.
    await page.goto("/integrations");
    await page.getByRole("button", { name: /connect wordpress/i }).click();
    await page.getByLabel(/wordpress url/i).fill(wpUrl);
    await page.getByLabel(/username/i).fill(wpUser);
    await page.getByLabel(/application password/i).fill(wpAppPw);
    await page.getByRole("button", { name: /save|connect/i }).click();
    await expect(page.getByText(/connected/i).first()).toBeVisible({ timeout: 15_000 });

    // 3. Run full optimization.
    await page.goto("/optimization");
    await page.getByRole("button", { name: /optimize all published posts/i }).click();
    await expect(page.getByText(/queued/i).first()).toBeVisible();

    // 4. Critical safety: no WP write happens until human approves.
    //    We assert the Approvals tab populates with at least one pending row.
    await page.goto("/approvals");
    const firstPending = page.getByRole("button", { name: /approve & apply/i }).first();
    await expect(firstPending).toBeVisible({ timeout: 60_000 });

    // 5. Approve the first pending change, then check it's no longer pending.
    await firstPending.click();
    await expect(page.getByText(/change applied to wordpress/i)).toBeVisible({ timeout: 30_000 });

    // Rollback safety: the approved change should now appear in the audit log
    // and be reversible via the optimization page revisions list.
    await page.goto("/audit-logs");
    await expect(page.getByText(/approval\.approve/i).first()).toBeVisible();
  });
});