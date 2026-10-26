import { createHash } from 'node:crypto';
import { expect, test } from '@playwright/test';
import type { Browser, BrowserContext, Page } from '@playwright/test';
import { gotoHydrated, settlePage } from './support/navigation';

const PASSWORD = 'geheim1234';

function uniqueEmail(label: string): string {
  return `hh-${label}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}@example.com`;
}

function localPart(email: string): string {
  return email.split('@')[0] ?? 'mitglied';
}

async function registerAndLogin(page: Page, email: string): Promise<void> {
  await gotoHydrated(page, '/register');
  await page.getByLabel('E-Mail-Adresse', { exact: true }).fill(email);
  await page.getByLabel('Passwort (mind. 8 Zeichen)', { exact: true }).fill(PASSWORD);
  await page.getByLabel('Passwort wiederholen', { exact: true }).fill(PASSWORD);
  await page.getByRole('button', { name: 'Konto anlegen' }).click();
  await expect(page).toHaveURL(/\/login\?registered=1/);
  await page.getByLabel('Passwort', { exact: true }).fill(PASSWORD);
  await page.getByRole('button', { name: 'Anmelden' }).click();
  await expect(page).toHaveURL(/\/lists$/);
}

async function newUserContext(browser: Browser): Promise<{ context: BrowserContext; page: Page }> {
  const baseURL = test.info().project.use.baseURL ?? 'http://localhost:3210';
  const context = await browser.newContext({ baseURL });
  const page = await context.newPage();
  return { context, page };
}

async function createHousehold(page: Page, name: string): Promise<void> {
  await gotoHydrated(page, '/household');
  await expect(page.getByTestId('create-household-card')).toBeVisible();
  await page.getByLabel('Haushaltsname').fill(name);
  await page.getByTestId('create-household').click();
  await expect(page.getByTestId('household-title')).toHaveText(name);
  // Die Seite feuert nach dem Anlegen `router.refresh()` (app/household/page.tsx).
  // Erst wenn dieser RSC-Fetch durch ist, ist die Route wieder navigationsbereit (D24).
  await settlePage(page);
}

async function createInviteLink(
  page: Page,
  role: 'owner' | 'editor' | 'viewer',
  expiry: '1h' | '1d' | '7d' = '7d',
): Promise<string> {
  await page.getByTestId('open-invite-dialog').click();
  await expect(page.getByTestId('invite-dialog')).toBeVisible();
  await page.getByTestId(`invite-role-${role}`).click();
  await page.getByLabel('Gueltig').selectOption(expiry);
  await page.getByTestId('invite-create').click();
  const linkInput = page.getByTestId('invite-link');
  await expect(linkInput).toBeVisible();
  const url = await linkInput.inputValue();
  await expect(page.getByTestId('invite-qr')).toBeVisible();
  await page.getByTestId('invite-done').click();
  await expect(page.getByTestId('invite-dialog')).toBeHidden();
  return url;
}

test('A-3/A-4: Einladung einloesen, Rolle wirkt sofort, Entfernen entzieht Zugriff, letzter Owner geschuetzt', async ({
  browser,
}) => {
  const owner = await newUserContext(browser);
  const invitee = await newUserContext(browser);
  const ownerEmail = uniqueEmail('owner');
  const inviteeEmail = uniqueEmail('invitee');
  const inviteeName = localPart(inviteeEmail);

  try {
    await registerAndLogin(owner.page, ownerEmail);
    await createHousehold(owner.page, 'E2E Haushalt');

    const inviteUrl = await createInviteLink(owner.page, 'editor');
    expect(inviteUrl).toMatch(/\/invite\/[A-Za-z0-9_-]{43}$/);

    await registerAndLogin(invitee.page, inviteeEmail);
    await gotoHydrated(invitee.page, inviteUrl);

    await expect(invitee.page.getByTestId('invite-preview')).toBeVisible();
    await expect(invitee.page.getByTestId('invite-role')).toHaveText('Editor');
    await expect(invitee.page.getByTestId('invite-preview')).toContainText('E2E Haushalt');

    // Ein-Hand-Nachweis: zentrale Aktionen sind >= 44 px hoch.
    const acceptBox = await invitee.page.getByTestId('invite-accept').boundingBox();
    expect(acceptBox?.height ?? 0).toBeGreaterThanOrEqual(44);

    await invitee.page.getByTestId('invite-accept').click();
    await expect(invitee.page.getByTestId('invite-success')).toBeVisible();
    await expect(invitee.page.getByTestId('invite-success')).toContainText('E2E Haushalt');
    await invitee.page.getByRole('link', { name: 'Zum Haushalt' }).click();
    await expect(invitee.page.getByTestId('household-title')).toHaveText('E2E Haushalt');

    // Editor darf schreiben (Rolle greift nach dem Beitritt).
    await invitee.page.getByTestId('write-probe').click();
    await expect(invitee.page.getByTestId('write-probe-result')).toHaveAttribute(
      'data-allowed',
      'true',
    );

    // Owner sieht das neue Mitglied nach dem Neuladen.
    await owner.page.reload();
    await expect(owner.page.getByTestId('member-count')).toHaveText('2 Personen');
    const inviteeRow = owner.page.getByTestId('member-row').filter({ hasText: inviteeName });
    await expect(inviteeRow).toBeVisible();
    await expect(inviteeRow.getByTestId('member-role')).toHaveText('Editor');

    // Editor -> Viewer wirkt sofort (ohne Reload auf B's Seite).
    await inviteeRow
      .getByRole('combobox', { name: `Rolle von ${inviteeName}` })
      .selectOption('viewer');
    await expect(owner.page.getByTestId('member-info')).toContainText('Viewer');
    await expect(inviteeRow.getByTestId('member-role')).toHaveText('Viewer');

    await invitee.page.getByTestId('write-probe').click();
    await expect(invitee.page.getByTestId('write-probe-result')).toHaveAttribute(
      'data-allowed',
      'false',
    );
    await expect(invitee.page.getByTestId('write-probe-result')).toContainText('verweigert');

    // Entfernen entzieht den Zugriff.
    await inviteeRow.getByRole('button', { name: 'Entfernen' }).click();
    await inviteeRow.getByTestId('remove-confirm').click();
    await expect(owner.page.getByTestId('member-count')).toHaveText('1 Person');

    await invitee.page.reload();
    await expect(invitee.page.getByTestId('create-household-card')).toBeVisible();
    await expect(invitee.page.getByTestId('household-title')).toBeHidden();

    // Letzter Owner kann nicht austreten (P0001 aus dem Backend-Vertrag).
    await owner.page.getByTestId('leave-household').click();
    await expect(owner.page.getByTestId('member-error')).toContainText('letzte Owner');
    await expect(owner.page.getByTestId('household-title')).toHaveText('E2E Haushalt');
  } finally {
    await owner.context.close();
    await invitee.context.close();
  }
});

test('A-3: abgelaufener und widerrufener Link werden mit unterscheidbarer Meldung abgelehnt', async ({
  browser,
}) => {
  const owner = await newUserContext(browser);
  const guest = await newUserContext(browser);

  try {
    await registerAndLogin(owner.page, uniqueEmail('owner2'));
    await createHousehold(owner.page, 'E2E Ablauf');

    // 1) Abgelaufener Link: Einladung anlegen, im Mock in die Vergangenheit zwingen.
    const expiredUrl = await createInviteLink(owner.page, 'viewer', '1h');
    const expiredToken = expiredUrl.split('/').pop() ?? '';
    const expiredHash = createHash('sha256').update(expiredToken).digest('hex');
    const debugResponse = await owner.page.request.post('/api/mock/household', {
      data: { action: 'debug-expire', tokenHash: expiredHash },
    });
    expect(debugResponse.ok()).toBeTruthy();
    const debugJson: unknown = await debugResponse.json();
    expect((debugJson as { ok?: unknown }).ok).toBe(true);

    await registerAndLogin(guest.page, uniqueEmail('guest'));
    await gotoHydrated(guest.page, expiredUrl);
    await expect(guest.page.getByTestId('invite-invalid')).toBeVisible();
    await expect(guest.page.getByTestId('invite-invalid')).toHaveAttribute(
      'data-reason',
      'expired',
    );
    await expect(guest.page.getByTestId('invite-invalid')).toContainText('abgelaufen');

    // 2) Widerrufener Link: neue Einladung anlegen und ueber die UI widerrufen.
    const revokedUrl = await createInviteLink(owner.page, 'viewer', '7d');
    await owner.page.getByRole('button', { name: 'Widerrufen' }).click();
    await owner.page.getByTestId('revoke-confirm').click();
    await expect(owner.page.getByTestId('member-info')).toContainText('widerrufen');

    await gotoHydrated(guest.page, revokedUrl);
    await expect(guest.page.getByTestId('invite-invalid')).toHaveAttribute(
      'data-reason',
      'revoked',
    );
    await expect(guest.page.getByTestId('invite-invalid')).toContainText('widerrufen');
  } finally {
    await owner.context.close();
    await guest.context.close();
  }
});
