import { test, expect } from '@playwright/test';

test('test', async ({ page }) => {
  await page.goto('https://practicetestautomation.com/contact/');
  await page.getByRole('textbox', { name: 'Comment or Message *' }).click();
  await page.getByRole('textbox', { name: 'Comment or Message *' }).fill('gghgg');
  await page.locator('iframe[name="a-4c7bu11ak084"]').contentFrame().getByRole('checkbox', { name: 'I\'m not a robot' }).click();
  await page.getByRole('button', { name: 'Submit' }).click();
});