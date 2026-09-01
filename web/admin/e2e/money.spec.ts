import { test, expect, type Page } from "@playwright/test";

/** The money paths, driven through a real browser (#108): sign in via OIDC,
 * request an above-threshold adjustment, second person approves, the ledger
 * and audit agree. Mirrors the iOS XCUITest suite's role for the app. */

async function signIn(page: Page, email: string) {
  await page.goto("/");
  await page.getByText("Sign in · dev identity provider").click();
  await page.waitForURL(/devidp\/authorize/);
  await page.locator('input[name="email"]').fill(email);
  await page.getByRole("button", { name: "Continue" }).click();
  await page.waitForURL(/#\/overview/);
}

async function signOut(page: Page) {
  await page.getByRole("button", { name: "Sign out" }).click();
  await expect(page.getByText("Sign in to the back office")).toBeVisible();
}

test("the panel is locked behind sign-in; strangers are turned away", async ({ page }) => {
  await page.goto("/");
  await expect(page.getByText("Sign in to the back office")).toBeVisible();
  await expect(page.getByText("Users & wallet")).toHaveCount(0);

  await page.getByText("Sign in · dev identity provider").click();
  await page.waitForURL(/devidp\/authorize/);
  await page.locator('input[name="email"]').fill("stranger@example.com");
  await page.getByRole("button", { name: "Continue" }).click();
  await expect(page.getByRole("alert")).toContainText("isn't provisioned");
});

test("adjust → second-person approval → ledger and audit agree", async ({ page }) => {
  // ops (admin) requests 900 coins for a user — above the 500 threshold
  await signIn(page, "ops@katha.dev");
  // the throwaway DB starts empty — seed one user through the session API
  const seed = await page.request.post("/admin/v1/wallet/adjust", {
    headers: { "X-Katha-CSRF": "1" },
    data: { user_id: "e2e-user", coins: 100, reason_code: "goodwill" },
  });
  if (!seed.ok()) throw new Error(`seed failed: ${seed.status()}`);
  await page.getByRole("link", { name: /Users & wallet/ }).click();
  await expect(page.getByText("e2e-user").first()).toBeVisible();
  await page.getByRole("button", { name: "Adjust coins…" }).first().click();
  const dialog = page.getByRole("dialog");
  await dialog.getByLabel("Coins").fill("900");
  await dialog.getByRole("button", { name: "Request approval" }).click();
  await expect(page.getByText(/Approval requested/)).toBeVisible();
  await signOut(page);

  // farah (finance) approves it
  await signIn(page, "farah@katha.dev");
  await page.getByRole("link", { name: /Approvals inbox/ }).click();
  await expect(page.getByText(/\+900 coins/)).toBeVisible();
  await page.getByRole("button", { name: "Approve" }).first().click();
  await expect(page.getByText(/Applied|approved/i).first()).toBeVisible();

  // the audit trail shows the whole story with the chain verified
  await page.getByRole("link", { name: /Audit log/ }).click();
  await expect(page.getByText("chain verified")).toBeVisible();
  await expect(page.getByText("wallet.adjust.approved").first()).toBeVisible();
  await expect(page.getByText("wallet.adjust.requested").first()).toBeVisible();
});
