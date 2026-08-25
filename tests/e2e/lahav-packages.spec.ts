import { expect, test as base, type BrowserContext, type Locator, type Page } from "@playwright/test";

const runtimeErrorPatterns = [
  /A tree hydrated/i,
  /hydration/i,
  /Maximum update depth exceeded/i,
];

const test = base.extend<{ runtimeErrors: string[] }>({
  runtimeErrors: async ({ page }, runFixture) => {
    const runtimeErrors: string[] = [];

    page.on("console", (message) => {
      if (message.type() === "error") {
        runtimeErrors.push(message.text());
      }
    });
    page.on("pageerror", (error) => runtimeErrors.push(error.message));

    await runFixture(runtimeErrors);

    const blockingErrors = runtimeErrors.filter((message) =>
      runtimeErrorPatterns.some((pattern) => pattern.test(message)),
    );
    expect(blockingErrors).toEqual([]);
  },
});

function app(page: Page) {
  return page.locator(".phone-frame");
}

function demoPath(path = "/") {
  const separator = path.includes("?") ? "&" : "?";
  return `${path}${separator}e2eDemo=1`;
}

async function keepNextDevOverlayFromBlockingClicks(page: Page) {
  await page
    .addStyleTag({
      content: "nextjs-portal { pointer-events: none !important; }",
    })
    .catch(() => undefined);
}

async function gotoAdmin(page: Page) {
  await page.addInitScript(() => window.localStorage.clear());
  await page.goto(demoPath("/"));
  await keepNextDevOverlayFromBlockingClicks(page);
  await expect(app(page).getByRole("heading", { name: "מה מצב החבילות?" })).toBeVisible();
}

async function gotoFreshUser(page: Page) {
  await page.addInitScript(() => window.localStorage.clear());
  await page.goto(demoPath("/?freshUser=1"));
  await keepNextDevOverlayFromBlockingClicks(page);
  await expect(app(page).getByText("הצטרפות לחבילות להב")).toBeVisible();
}

async function clickPhoneNav(page: Page, name: string) {
  await keepNextDevOverlayFromBlockingClicks(page);
  await app(page).locator(".bottom-nav").getByRole("button", { name }).click();
}

async function openAdmin(page: Page) {
  await clickPhoneNav(page, "בית");
  await app(page).locator(".admin-header-button").click();
  await expect(app(page).getByRole("heading", { name: "ניהול קהילה" })).toBeVisible();
}

const weekdayLabels = ["א׳", "ב׳", "ג׳", "ד׳", "ה׳", "ו׳", "שבת"];

async function readPickupCount(page: Page, locationId: string) {
  const text = await app(page)
    .locator(`.pickup-card[data-pickup-location-id="${locationId}"] strong`)
    .textContent();
  return Number(text?.trim() ?? "0");
}

async function readHomeStatusCount(page: Page, statusClass: string) {
  const text = await app(page).locator(`.${statusClass} strong`).textContent();
  return Number(text?.trim() ?? "0");
}

type StatusCounts = {
  waiting: number;
  collected: number;
  arrived: number;
};

async function readHomeStatusCounts(page: Page): Promise<StatusCounts> {
  return {
    waiting: await readHomeStatusCount(page, "home-status-waiting"),
    collected: await readHomeStatusCount(page, "home-status-collected"),
    arrived: await readHomeStatusCount(page, "home-status-arrived"),
  };
}

async function readPackageListStatusCounts(page: Page): Promise<StatusCounts> {
  return app(page).locator(".package-card").evaluateAll((cards) => {
    const counts = {
      waiting: 0,
      collected: 0,
      arrived: 0,
    };

    cards.forEach((card) => {
      const statusElement = card.querySelector(
        ".status-action-badge, .badge.waiting, .badge.blue, .badge.arrived",
      );
      const text = statusElement?.textContent ?? "";

      if (text.includes("ממתינה לאיסוף")) counts.waiting += 1;
      if (text.includes("נאספה")) counts.collected += 1;
      if (text.includes("נמסרה בקיבוץ")) counts.arrived += 1;
    });

    return counts;
  });
}

async function expectHomeStatusSync(page: Page, expected: StatusCounts) {
  await expect(app(page).locator(".home-status-waiting strong")).toHaveText(String(expected.waiting), {
    timeout: 5000,
  });
  await expect(app(page).locator(".home-status-collected strong")).toHaveText(
    String(expected.collected),
    { timeout: 5000 },
  );
  await expect(app(page).locator(".home-status-arrived strong")).toHaveText(String(expected.arrived), {
    timeout: 5000,
  });
  await expect.poll(() => readPackageListStatusCounts(page), { timeout: 5000 }).toEqual(expected);
}

async function addPackageForPickupLocation(page: Page, ownerName: string, locationId: string) {
  await clickPhoneNav(page, "הוספה");
  await app(page).locator("#owner").fill(ownerName);
  await app(page).locator("#pickup-location").selectOption(locationId);
  await app(page)
    .locator("#message")
    .fill(`בדיקת סנכרון עבור ${ownerName}. קוד 123456. קישור https://example.com/${locationId}`);
  await app(page).getByRole("button", { name: /הוסף חבילה/ }).click();
  await expect(app(page).locator(".added-package-row").filter({ hasText: ownerName })).toBeVisible({
    timeout: 5000,
  });
}

async function expectPackageCardStatus(page: Page, ownerName: string, statusText: string) {
  const card = app(page).locator(".package-card").filter({ hasText: ownerName });
  await expect(card).toBeVisible({ timeout: 5000 });
  await expect(card).toContainText(statusText, { timeout: 5000 });
}

async function collectPackageAtLocation(
  context: BrowserContext,
  page: Page,
  locationId: string,
  ownerName: string,
  expectedAfterCollection: "collected" | "arrived" = "collected",
) {
  await clickPhoneNav(page, "איסוף");
  await app(page).locator(`.location-button[data-pickup-location-id="${locationId}"]`).click();

  const confirmDialog = page.getByRole("dialog", { name: "האם אתה כבר בנקודת האיסוף?" });
  if ((await confirmDialog.count()) > 0) {
    await confirmDialog.getByRole("button", { name: "אשר" }).click();
  }

  await expect(app(page).getByText("איסוף בחנות")).toBeVisible();
  const catalogCard = app(page).locator(".catalog-card").filter({ hasText: ownerName });
  await expect(catalogCard).toBeVisible({ timeout: 5000 });
  await openPickupApprovalLinkIfPresent(context, catalogCard);
  const collectButton = catalogCard.locator(".collect-button");
  await collectButton.click();
  if (expectedAfterCollection === "arrived") {
    await expect(collectButton).toBeEnabled();
    await expect(collectButton).toHaveAttribute("aria-pressed", "true");
    await expect(collectButton).toContainText("נמסרה בקיבוץ");
  } else {
    await expect(collectButton).toHaveAttribute("aria-pressed", "true");
  }
}

async function openPickupApprovalLinkIfPresent(context: BrowserContext, card: Locator) {
  void context;
  const pickupLink = card.locator(".original-message a").first();
  if ((await pickupLink.count()) === 0) return;

  await expect(pickupLink).toHaveAttribute("href", /^https?:\/\//);
}

async function expectNoVerticalOverlap(container: Locator, selector: string) {
  const overlaps = await container.locator(selector).evaluateAll((elements) => {
    const rects = elements
      .filter((element) => {
        const rect = element.getBoundingClientRect();
        return rect.width > 0 && rect.height > 0;
      })
      .map((element) => element.getBoundingClientRect())
      .sort((a, b) => a.top - b.top);

    return rects.some((rect, index) => {
      const next = rects[index + 1];
      return next ? next.top < rect.bottom - 1 : false;
    });
  });

  expect(overlaps).toBe(false);
}

test("fresh users can request access but cannot add or pick up before approval", async ({ page }) => {
  await gotoFreshUser(page);

  await expect(app(page).locator(".bottom-nav button")).toHaveCount(4);
  await expect(app(page).locator(".bottom-nav")).not.toContainText("ניהול");
  await expect(app(page).locator(".bottom-nav").getByRole("button", { name: "מסירה" })).toBeDisabled();

  await app(page).getByLabel("מספר טלפון נייד").fill("052-111-2222");
  await app(page).getByLabel("שם מלא").fill("משתמש בדיקה");
  await app(page).getByLabel("הערה למנהל").fill("בדיקת הצטרפות");
  await app(page).getByRole("button", { name: /שלח בקשת הצטרפות/ }).click();

  await expect(app(page).getByRole("heading", { name: "ממתין לאישור מנהל" })).toBeVisible();

  await clickPhoneNav(page, "הוספה");
  await expect(page.getByRole("status")).toContainText(
    "לא ניתן להוסיף חבילה לפני אישור משתמש חדש",
  );

  await clickPhoneNav(page, "איסוף");
  await expect(page.getByRole("status")).toContainText(
    "לא ניתן לאסוף חבילה לפני אישור משתמש חדש",
  );
});

test("join screen uses placeholders instead of demo name and phone values", async ({ page }) => {
  await gotoFreshUser(page);

  await expect(app(page).getByLabel("עזרה להצטרפות")).toHaveCount(0);

  const phoneInput = app(page).locator("#join-phone");
  const nameInput = app(page).locator("#join-name");

  await expect(phoneInput).toHaveValue("");
  await expect(phoneInput).toHaveAttribute("placeholder", "050-1234567");
  await expect(nameInput).toHaveValue("");
  await expect(nameInput).toHaveAttribute("placeholder", "ישראלה ישראלי");

  await phoneInput.fill("052-111-2222");
  await nameInput.fill("משתמש בדיקה");
  await expect(phoneInput).toHaveValue("052-111-2222");
  await expect(nameInput).toHaveValue("משתמש בדיקה");
});

test("approved phone can enter from a new device without another admin approval", async ({ page }) => {
  await gotoFreshUser(page);

  await app(page).getByLabel("מספר טלפון נייד").fill("+972501111111");
  await app(page).getByLabel("שם מלא").fill("שם אחר");
  await app(page).getByRole("button", { name: /שלח בקשת הצטרפות/ }).click();

  await expect(page.getByRole("status")).toContainText("זוהית כמשתמש מאושר");
  await expect(app(page).getByRole("heading", { name: "מה מצב החבילות?" })).toBeVisible();
  await expect(app(page).locator(".bottom-nav").getByRole("button", { name: "הוספה" })).toBeEnabled();
});

test("regular member can remove a waiting package they added", async ({ page }) => {
  await gotoFreshUser(page);

  await app(page).getByLabel("מספר טלפון נייד").fill("+972501111111");
  await app(page).getByLabel("שם מלא").fill("משתמש מחיקה");
  await app(page).getByRole("button", { name: /שלח בקשת הצטרפות/ }).click();
  await expect(app(page).getByRole("heading", { name: "מה מצב החבילות?" })).toBeVisible();

  const packageName = "חבילת מחיקה משתמש רגיל";
  await addPackageForPickupLocation(page, packageName, "pitzutz");
  await clickPhoneNav(page, "בית");

  const packageCard = app(page).locator(".package-card").filter({ hasText: packageName });
  await expect(packageCard).toBeVisible();
  await packageCard.getByRole("button", { name: "הסר חבילה" }).click();
  const dialog = page.getByRole("dialog", { name: "להסיר את החבילה?" });
  await expect(dialog).toBeVisible();
  await dialog.getByRole("button", { name: "הסר חבילה" }).click();

  await expect(packageCard).toHaveCount(0);
});

test("admin can approve pending users and approved users appear as regular members", async ({ page }) => {
  await gotoAdmin(page);
  await expect(app(page).locator(".bottom-nav button")).toHaveCount(4);
  await expect(app(page).locator(".bottom-nav").getByRole("button", { name: "מסירה" })).toBeEnabled();
  await clickPhoneNav(page, "מסירה");
  await expect(app(page).getByRole("heading", { name: "החבילות הגיעו" })).toBeVisible();
  await expect(app(page)).toContainText("אין כרגע חבילות שסומנו כנאספו על ידך.");
  await expect(app(page).locator(".arrival-package-submit")).toHaveCount(0);
  await openAdmin(page);

  const pendingCard = app(page).locator(".admin-card").filter({ hasText: "050-203-4475" });
  await expect(pendingCard).toContainText("ממתין");
  await pendingCard.getByRole("button", { name: /אשר/ }).click();

  await expect(page.getByRole("status")).toContainText("המשתמש אושר");
  await app(page).getByRole("button", { name: /מאושרים/ }).click();
  await expect(app(page).locator(".admin-card").filter({ hasText: "050-203-4475" })).toContainText(
    "חברה רגילה",
  );
});

test("admin can reject pending users and the pending list updates", async ({ page }) => {
  await gotoAdmin(page);
  await openAdmin(page);

  const pendingCard = app(page).locator(".admin-card").filter({ hasText: "050-203-4475" });
  await pendingCard.getByRole("button", { name: /דחה/ }).click();

  await expect(page.getByRole("status")).toContainText("בקשת ההצטרפות נדחתה");
  await expect(app(page).getByText("אין בקשות שממתינות לטיפול")).toBeVisible();
  await expect(app(page).locator(".admin-card").filter({ hasText: "050-203-4475" })).toHaveCount(0);
});

test("admin pickup confirmations show who confirmed and which package was collected", async ({
  context,
  page,
}) => {
  await gotoAdmin(page);
  await collectPackageAtLocation(context, page, "pitzutz", "הילה נבו");
  await openAdmin(page);

  const audit = app(page).locator(".admin-pickup-audit");
  await expect(audit.getByText("אישורי איסוף חבילות")).toBeVisible();

  const confirmation = audit
    .locator(".admin-pickup-audit-row")
    .filter({ hasText: "פיצוץ להבים" })
    .first();
  await expect(confirmation).toContainText("עוז כרמל");
  await expect(confirmation).toContainText("נאספה חבילה אחת עבור: הילה נבו");
  await expect(confirmation.locator("time")).not.toBeEmpty();

  const toggle = audit.getByRole("button", { name: /אישורי איסוף חבילות/ });
  await expect(toggle).toHaveAttribute("aria-expanded", "true");
  await toggle.click();
  await expect(toggle).toHaveAttribute("aria-expanded", "false");
  await expect(audit.locator(".admin-pickup-audit-list")).toHaveCount(0);
  await toggle.click();
  await expect(confirmation).toBeVisible();
});
test("admin status correction keeps Home and pickup catalog synchronized", async ({ page }) => {
  await gotoAdmin(page);
  await openAdmin(page);
  await app(page)
    .locator(".summary-grid")
    .getByRole("button", { name: /חבילות/ })
    .click();

  const adminPackageCard = app(page).locator(".admin-card").filter({ hasText: "הילה נבו" });
  await adminPackageCard
    .getByRole("button", { name: "העבר את הילה נבו לסטטוס נאספה" })
    .click();
  await expect(page.getByRole("status")).toContainText("החבילה עודכנה כנאספה");

  await clickPhoneNav(page, "בית");
  await expectPackageCardStatus(page, "הילה נבו", "נאספה");

  await clickPhoneNav(page, "איסוף");
  await app(page).locator('.location-button[data-pickup-location-id="pitzutz"]').click();
  await page
    .getByRole("dialog", { name: "האם אתה כבר בנקודת האיסוף?" })
    .getByRole("button", { name: "אשר" })
    .click();
  await expect(app(page).locator(".catalog-card").filter({ hasText: "הילה נבו" })).toHaveCount(0);

  await openAdmin(page);
  await app(page)
    .locator(".summary-grid")
    .getByRole("button", { name: /חבילות/ })
    .click();
  await app(page)
    .locator(".admin-card")
    .filter({ hasText: "הילה נבו" })
    .getByRole("button", { name: "העבר את הילה נבו לסטטוס ממתינה לאיסוף" })
    .click();
  await expect(page.getByRole("status")).toContainText("החבילה הוחזרה לממתינה לאיסוף");

  await clickPhoneNav(page, "בית");
  await expectPackageCardStatus(page, "הילה נבו", "ממתינה לאיסוף");

  await clickPhoneNav(page, "איסוף");
  await app(page).locator('.location-button[data-pickup-location-id="pitzutz"]').click();
  await page
    .getByRole("dialog", { name: "האם אתה כבר בנקודת האיסוף?" })
    .getByRole("button", { name: "אשר" })
    .click();
  const restoredCatalogCard = app(page)
    .locator(".catalog-card")
    .filter({ hasText: "הילה נבו" });
  await expect(restoredCatalogCard).toBeVisible();
  await expect(restoredCatalogCard.locator(".original-message")).toBeVisible();
});
test("admin-created pickup locations appear across home, add, pickup, and hours flows", async ({
  page,
}) => {
  await gotoAdmin(page);
  await openAdmin(page);

  await app(page).getByRole("button", { name: /הוסף נקודת איסוף/ }).click();
  const modal = page.getByRole("dialog", { name: "הוסף נקודת איסוף" });
  await expect(modal).toBeVisible();
  await modal.getByLabel("שם נקודת איסוף").fill("נקודת בדיקה");
  await modal.getByLabel("כתובת מלאה או תיאור מקום").fill("כניסה לקיבוץ להב");
  await modal.getByLabel("שעות פתיחה לתצוגה").fill("א-ה 08:00-13:00");
  await modal.locator(".hours-day-row").filter({ hasText: "א׳" }).getByRole("checkbox").first().check();
  await modal.getByRole("button", { name: /הוסף/ }).click();

  await expect(modal).toBeHidden();
  await expect(page.getByRole("status")).toContainText("נקודת האיסוף נוספה");

  await clickPhoneNav(page, "בית");
  await expect(app(page).locator(".location-strip")).toContainText("נקודת בדיקה");
  await app(page).getByLabel("שעות פתיחה - נקודת בדיקה").click();
  await expect(page.getByRole("dialog", { name: "שעות פתיחה" })).toContainText("08:00-13:00");
  await page.getByRole("dialog", { name: "שעות פתיחה" }).getByRole("button", { name: "סגור" }).click();

  await clickPhoneNav(page, "הוספה");
  await expect(app(page).locator("#pickup-location")).toContainText("נקודת בדיקה");

  await clickPhoneNav(page, "איסוף");
  await expect(app(page).locator(".location-button").filter({ hasText: "נקודת בדיקה" })).toBeVisible();
});

test("add package uses example placeholders without saving empty demo values", async ({ page }) => {
  await gotoAdmin(page);
  await clickPhoneNav(page, "הוספה");

  const ownerInput = app(page).locator("#owner");
  const messageInput = app(page).locator("#message");

  await expect(ownerInput).toHaveValue("");
  await expect(ownerInput).toHaveAttribute("placeholder", "עוז כרמל");
  await expect(app(page).locator("#pickup-location")).toHaveValue("pitzutz");
  await expect(messageInput).toHaveValue("");
  await expect(messageInput).toHaveAttribute(
    "placeholder",
    "הדביקו כאן במלואה את ההודעה שקיבלתם ב-SMS או במייל, כולל קוד וקישור. ההודעה שמורה בצורה מאובטחת ורק מי שאוסף יוכל לראות אותה.",
  );

  const addButton = app(page).getByRole("button", { name: /הוסף חבילה/ });
  await expect(addButton).toBeDisabled();
  await expect(ownerInput).toBeVisible();

  await ownerInput.fill("עוז כרמל בדיקה");
  await expect(addButton).toBeDisabled();
  await expect(messageInput).toBeVisible();

  await messageInput.fill(
    "שלום עוז, משלוח AE04062389 ממתין לאיסוף בפיצוץ להבים. לאישור איסוף לחצו: https://u.cheetahint.com/vknpgt0",
  );
  await expect(addButton).toBeEnabled();
  await addButton.click();
  await expect(page.getByRole("status")).toContainText("החבילה נוספה");

  await expect(app(page).getByRole("heading", { name: "חבילות שהוספת" })).toBeVisible();
  await expect(
    app(page).getByText("צפה בחבילות שהוספו בעבר וערוך פרטי חבילה"),
  ).toBeVisible();
  const addedPackage = app(page).locator(".added-package-row").filter({ hasText: "עוז כרמל בדיקה" });
  await expect(addedPackage).toContainText("נוספה עכשיו");
  await expect(addedPackage).toContainText("פיצוץ להבים");
  await expect(addedPackage).toContainText("https://u.cheetahint.com/vknpgt0");
  await addedPackage.getByRole("button", { name: "ערוך" }).click();
  await expect(app(page).getByText("עריכת חבילה קיימת")).toBeVisible();
  await expect(ownerInput).toHaveValue("עוז כרמל בדיקה");
  await ownerInput.fill("עוז כרמל עריכה");
  await app(page).getByRole("button", { name: /עדכן פרטים/ }).click();
  await expect(page.getByRole("status")).toContainText("החבילה עודכנה");
  const editedPackage = app(page).locator(".added-package-row").filter({ hasText: "עוז כרמל עריכה" });
  await expect(editedPackage).toBeVisible();
  await expect(editedPackage).toContainText("נוספה עכשיו");
});

test("new package appears on home under its pickup location and package status within five seconds", async ({
  page,
}) => {
  await gotoAdmin(page);

  const beforeLocationCount = await readPickupCount(page, "pitzutz");
  const beforeWaitingCount = await readHomeStatusCount(page, "home-status-waiting");

  await clickPhoneNav(page, "הוספה");
  await app(page).getByLabel("שם מקבל החבילה").fill("בדיקת סנכרון מיידי");
  await app(page).locator("#pickup-location").selectOption("pitzutz");
  await app(page)
    .getByLabel("הודעת המשלוח המקורית")
    .fill(
      "שלום בדיקה, משלוח SYNC-001 ממתין לאיסוף בפיצוץ להבים. קוד 123456. לאישור איסוף: https://example.com/sync-001",
    );
  await app(page).getByRole("button", { name: /הוסף חבילה/ }).click();

  await expect(app(page).locator(".added-package-row").filter({ hasText: "בדיקת סנכרון מיידי" })).toBeVisible();
  await clickPhoneNav(page, "בית");
  await expect(app(page).getByRole("heading", { name: "מה מצב החבילות?" })).toBeVisible();
  await expect(app(page).locator(".home-status-band")).toContainText("ממתינות לאיסוף");
  await expect(app(page).locator(".home-status-band")).toContainText("נאספו");
  await expect(app(page).locator(".home-status-band")).toContainText("נמסרו בקיבוץ");
  await expect(app(page).locator(".home-status-item")).toHaveCount(3);
  await expect(app(page).locator(".home-status-band")).not.toContainText("נתקבלו");
  await expect(app(page).locator(".home-status-waiting strong")).toHaveText(
    String(beforeWaitingCount + 1),
    { timeout: 5000 },
  );
  await expect(app(page).locator('.pickup-card[data-pickup-location-id="pitzutz"] strong')).toHaveText(
    String(beforeLocationCount + 1),
    { timeout: 5000 },
  );

  const newPackageCard = app(page).locator(".package-card").filter({
    hasText: "בדיקת סנכרון מיידי",
  });
  await expect(newPackageCard).toBeVisible({ timeout: 5000 });
  await expect(newPackageCard).toContainText("פיצוץ להבים", { timeout: 5000 });
  await expect(newPackageCard).toContainText("ממתינה לאיסוף", { timeout: 5000 });
});

test("packages added to each pickup location increase only that location count", async ({ page }) => {
  const locationIds = [
    "home-paami",
    "post-office",
    "pitzutz",
    "eshkolot",
    "deli-place",
    "shoval",
  ];

  await gotoAdmin(page);

  for (const locationId of locationIds) {
    const beforeCount = await readPickupCount(page, locationId);

    await clickPhoneNav(page, "הוספה");
    await app(page).getByLabel("שם מקבל החבילה").fill(`בדיקה ${locationId}`);
    await app(page).locator("#pickup-location").selectOption(locationId);
    await app(page)
      .getByLabel("הודעת המשלוח המקורית")
      .fill(`Package for ${locationId}. Approval link: https://example.com/${locationId}`);
    await app(page).getByRole("button", { name: /הוסף חבילה/ }).click();

    await clickPhoneNav(page, "בית");
    await expect(app(page).getByRole("heading", { name: "מה מצב החבילות?" })).toBeVisible();
    await expect(
      app(page).locator(`.pickup-card[data-pickup-location-id="${locationId}"] strong`),
    ).toHaveText(String(beforeCount + 1));
    await expect(app(page).locator(".package-list").first()).toContainText(`בדיקה ${locationId}`);
  }
});

test("top package status capsules open a bottom sheet with matching packages", async ({ page }) => {
  await gotoAdmin(page);

  await app(page).locator(".home-status-waiting").click();
  await expect(page.getByRole("dialog", { name: "ממתינות לאיסוף" })).toBeVisible();
  await expect(page.locator(".status-bottom-sheet")).toContainText("עוז כרמל");
  await expect(page.locator(".status-bottom-sheet")).toContainText("הילה נבו");
  await page.getByRole("button", { name: "סגור" }).click();
  await expect(page.getByRole("dialog", { name: "ממתינות לאיסוף" })).toHaveCount(0);

  await app(page).locator(".home-status-arrived").click();
  await expect(page.getByRole("dialog", { name: "נמסרו בקיבוץ" })).toBeVisible();
  await expect(page.locator(".status-bottom-sheet")).toContainText("נעה אמבולוס");
  await page.getByRole("button", { name: "סגור" }).click();

  await expect(app(page).locator(".home-status-delivered")).toHaveCount(0);
});

test("collecting one location does not hide active packages from other locations on home", async ({
  context,
  page,
}) => {
  await gotoAdmin(page);

  await addPackageForPickupLocation(page, "משה בדואר", "post-office");
  await addPackageForPickupLocation(page, "בונו בפיצוץ", "pitzutz");

  await clickPhoneNav(page, "איסוף");
  await app(page).locator('.location-button[data-pickup-location-id="post-office"]').click();
  await page
    .getByRole("dialog", { name: "האם אתה כבר בנקודת האיסוף?" })
    .getByRole("button", { name: "אשר" })
    .click();

  const mosheCard = app(page).locator(".catalog-card").filter({ hasText: "משה בדואר" });
  await expect(mosheCard).toBeVisible();
  await openPickupApprovalLinkIfPresent(context, mosheCard);
  const mosheCollectButton = mosheCard.locator(".collect-button");
  await mosheCollectButton.click();
  await expect(mosheCollectButton).toBeEnabled();
  await expect(mosheCollectButton).toHaveAttribute("aria-pressed", "true");
  await expect(mosheCollectButton).toContainText("נמסרה בקיבוץ");

  await clickPhoneNav(page, "בית");
  await expect(app(page).getByRole("heading", { name: "מה מצב החבילות?" })).toBeVisible();
  await expect(app(page).locator(".package-list")).toContainText("משה בדואר", {
    timeout: 5000,
  });
  await expect(app(page).locator(".package-list")).toContainText("בונו בפיצוץ", {
    timeout: 5000,
  });
  await expect(app(page).locator(".package-list")).toContainText("נמסרה בקיבוץ");
  await expect(app(page).locator(".package-list")).toContainText("ממתינה לאיסוף");
});

test("multi-package self-collection keeps home counters, pickup counts, and package statuses synchronized", async ({
  context,
  page,
}) => {
  test.setTimeout(120_000);

  const packages = [
    { name: "זרימה דואר אחת", locationId: "post-office" },
    { name: "זרימה דואר שתיים", locationId: "post-office" },
    { name: "זרימה פיצוץ אחת", locationId: "pitzutz" },
    { name: "זרימה פיצוץ שתיים", locationId: "pitzutz" },
    { name: "זרימה אשכולות", locationId: "eshkolot" },
    { name: "זרימה דלי", locationId: "deli-place" },
  ];

  await gotoAdmin(page);
  const baseline = await readHomeStatusCounts(page);
  await expectHomeStatusSync(page, baseline);

  const baselinePickupCounts = {
    postOffice: await readPickupCount(page, "post-office"),
    pitzutz: await readPickupCount(page, "pitzutz"),
    eshkolot: await readPickupCount(page, "eshkolot"),
    deliPlace: await readPickupCount(page, "deli-place"),
  };

  for (const item of packages) {
    await addPackageForPickupLocation(page, item.name, item.locationId);
  }

  await clickPhoneNav(page, "בית");
  await expectHomeStatusSync(page, {
    ...baseline,
    waiting: baseline.waiting + 6,
  });
  await expect(app(page).locator('.pickup-card[data-pickup-location-id="post-office"] strong')).toHaveText(
    String(baselinePickupCounts.postOffice + 2),
  );
  await expect(app(page).locator('.pickup-card[data-pickup-location-id="pitzutz"] strong')).toHaveText(
    String(baselinePickupCounts.pitzutz + 2),
  );
  await expect(app(page).locator('.pickup-card[data-pickup-location-id="eshkolot"] strong')).toHaveText(
    String(baselinePickupCounts.eshkolot + 1),
  );
  await expect(app(page).locator('.pickup-card[data-pickup-location-id="deli-place"] strong')).toHaveText(
    String(baselinePickupCounts.deliPlace + 1),
  );
  for (const item of packages) {
    await expectPackageCardStatus(page, item.name, "ממתינה לאיסוף");
  }

  await collectPackageAtLocation(context, page, "post-office", "זרימה דואר אחת", "arrived");
  await collectPackageAtLocation(context, page, "pitzutz", "זרימה פיצוץ אחת", "arrived");
  await collectPackageAtLocation(context, page, "deli-place", "זרימה דלי", "arrived");

  await clickPhoneNav(page, "בית");
  await expectHomeStatusSync(page, {
    ...baseline,
    waiting: baseline.waiting + 3,
    arrived: baseline.arrived + 3,
  });
  await expect(app(page).locator('.pickup-card[data-pickup-location-id="post-office"] strong')).toHaveText(
    String(baselinePickupCounts.postOffice + 1),
  );
  await expect(app(page).locator('.pickup-card[data-pickup-location-id="pitzutz"] strong')).toHaveText(
    String(baselinePickupCounts.pitzutz + 1),
  );
  await expect(app(page).locator('.pickup-card[data-pickup-location-id="eshkolot"] strong')).toHaveText(
    String(baselinePickupCounts.eshkolot + 1),
  );
  await expect(app(page).locator('.pickup-card[data-pickup-location-id="deli-place"] strong')).toHaveText(
    String(baselinePickupCounts.deliPlace),
  );
  await expectPackageCardStatus(page, "זרימה דואר אחת", "נמסרה בקיבוץ");
  await expectPackageCardStatus(page, "זרימה דואר שתיים", "ממתינה לאיסוף");
  await expectPackageCardStatus(page, "זרימה פיצוץ אחת", "נמסרה בקיבוץ");
  await expectPackageCardStatus(page, "זרימה פיצוץ שתיים", "ממתינה לאיסוף");
  await expectPackageCardStatus(page, "זרימה אשכולות", "ממתינה לאיסוף");
  await expectPackageCardStatus(page, "זרימה דלי", "נמסרה בקיבוץ");

  await clickPhoneNav(page, "מסירה");
  await expect(app(page).getByRole("heading", { name: "החבילות הגיעו" })).toBeVisible();
  await expect(app(page).locator(".arrival-package-card")).toHaveCount(0);
  await expect(app(page)).toContainText("אין כרגע חבילות שסומנו כנאספו על ידך.");
  await collectPackageAtLocation(context, page, "post-office", "זרימה דואר שתיים", "arrived");

  await clickPhoneNav(page, "בית");
  await expectHomeStatusSync(page, {
    ...baseline,
    waiting: baseline.waiting + 2,
    arrived: baseline.arrived + 4,
  });
  await expect(app(page).locator('.pickup-card[data-pickup-location-id="post-office"] strong')).toHaveText(
    String(baselinePickupCounts.postOffice),
  );
  await expectPackageCardStatus(page, "זרימה דואר שתיים", "נמסרה בקיבוץ");
  await expectPackageCardStatus(page, "זרימה פיצוץ שתיים", "ממתינה לאיסוף");
  await expectPackageCardStatus(page, "זרימה אשכולות", "ממתינה לאיסוף");
  await expectPackageCardStatus(page, "זרימה פיצוץ אחת", "נמסרה בקיבוץ");
  await expectPackageCardStatus(page, "זרימה דלי", "נמסרה בקיבוץ");
  await expectPackageCardStatus(page, "זרימה דואר אחת", "נמסרה בקיבוץ");
});

test("saving two kibbutz delivery rows updates home status and shows both packages", async ({
  context,
  page,
}) => {
  await gotoAdmin(page);

  const beforeArrivedCount = await readHomeStatusCount(page, "home-status-arrived");
  const collectedNames = ["הילה נבו", "איילת מדר"];

  await collectPackageAtLocation(context, page, "pitzutz", collectedNames[0]);
  await collectPackageAtLocation(context, page, "pitzutz", collectedNames[1]);

  await clickPhoneNav(page, "מסירה");
  await expect(app(page).getByRole("heading", { name: "החבילות הגיעו" })).toBeVisible();

  const arrivalCards = app(page).locator(".arrival-package-card");
  await expect(arrivalCards).toHaveCount(2);

  await arrivalCards.nth(0).locator(".arrival-package-toggle").click();
  await arrivalCards.nth(0).locator("select[id^='drop-location-']").selectOption("gate-crate");
  await arrivalCards.nth(0).locator(".arrival-package-submit").click();
  await expect(arrivalCards).toHaveCount(1);

  await arrivalCards.nth(0).locator(".arrival-package-toggle").click();
  await arrivalCards.nth(0).locator("select[id^='drop-location-']").selectOption("kolbo");
  await arrivalCards.nth(0).locator(".arrival-package-submit").click();
  await expect(arrivalCards).toHaveCount(0);

  await clickPhoneNav(page, "בית");
  await expect(app(page).getByRole("heading", { name: "מה מצב החבילות?" })).toBeVisible();
  await expect(app(page).locator(".home-status-arrived strong")).toHaveText(
    String(beforeArrivedCount + 2),
    { timeout: 5000 },
  );

  await expect
    .poll(
      async () =>
        app(page).locator(".package-card").evaluateAll(
          (cards, expectedNames) =>
            expectedNames.every((expectedName) =>
              cards.some((card) => {
                const packageName =
                  card.querySelector(".package-name")?.textContent?.trim() ?? "";
                return (
                  packageName === expectedName &&
                  (card.textContent ?? "").includes("נמסרה בקיבוץ")
                );
              }),
            ),
          collectedNames,
        ),
      { timeout: 5000 },
    )
    .toBe(true);
  await expect(app(page).locator(".package-list")).toContainText("שמתי בדולב", {
    timeout: 5000,
  });
  await expect(app(page).locator(".package-list")).toContainText("שמתי בארון הכלבו למעלה", {
    timeout: 5000,
  });
});

test("home pickup locations open details when open, closed, or empty", async ({ page }) => {
  await page.clock.setFixedTime(new Date("2026-08-02T12:00:00+03:00"));
  await gotoAdmin(page);

  const openLocation = app(page).locator('.pickup-card[data-pickup-location-id="home-paami"]');
  const openCount = await readPickupCount(page, "home-paami");
  await expect(openLocation).toHaveClass(/pickup-card-open/);
  await openLocation.click();
  await expect(app(page).getByText("פרטי נקודת איסוף", { exact: true })).toBeVisible();
  await expect(app(page).locator('.location-details-screen[data-pickup-location-id="home-paami"]')).toBeVisible();
  await expect(app(page).getByRole("heading", { name: "הום פעמי" })).toBeVisible();
  await expect(app(page).getByText("פתוח עכשיו", { exact: true })).toBeVisible();
  await expect(app(page).getByLabel(`${openCount} חבילות ממתינות`)).toBeVisible();
  await expect(app(page).getByRole("heading", { name: "שעות פתיחה" })).toBeVisible();
  await app(page).getByRole("button", { name: "חזרה" }).click();

  const closedLocation = app(page).locator('.pickup-card[data-pickup-location-id="post-office"]');
  await expect(closedLocation).toHaveClass(/pickup-card-closed/);
  await closedLocation.click();
  await expect(app(page).locator('.location-details-screen[data-pickup-location-id="post-office"]')).toBeVisible();
  await expect(app(page).getByText("סגור עכשיו", { exact: true })).toBeVisible();
  await expect(app(page).getByRole("heading", { name: "שעות פתיחה" })).toBeVisible();
  await app(page).getByRole("button", { name: "חזרה" }).click();

  await expect(app(page).locator('.pickup-card[data-pickup-location-id="shoval"] strong')).toHaveText("0");
  await app(page).locator('.pickup-card[data-pickup-location-id="shoval"]').click();
  await expect(app(page).locator('.location-details-screen[data-pickup-location-id="shoval"]')).toBeVisible();
  await expect(app(page).getByLabel("0 חבילות ממתינות")).toBeVisible();
  await expect(page.getByRole("dialog", { name: "האם אתה כבר בנקודת האיסוף?" })).toHaveCount(0);
});

test("home waiting package shortcuts open pickup screen with the location selected", async ({
  page,
}) => {
  await gotoAdmin(page);

  const waitingPackageCard = app(page).locator(".package-card").filter({ hasText: "עוז כרמל" }).first();
  await waitingPackageCard.getByRole("button", { name: "ממתינה לאיסוף" }).click();
  await expect(app(page).getByRole("heading", { name: "איסוף בחנות" })).toBeVisible();
  await expect(page.getByRole("dialog", { name: "האם אתה כבר בנקודת האיסוף?" })).toHaveCount(0);
  await expect(app(page).locator('.location-button[data-pickup-location-id="pitzutz"]')).toHaveAttribute(
    "aria-pressed",
    "true",
  );

  await clickPhoneNav(page, "בית");
  await app(page).locator(".status-action-badge").first().click();
  await expect(app(page).getByRole("heading", { name: "איסוף בחנות" })).toBeVisible();
  await expect(page.getByRole("dialog", { name: "האם אתה כבר בנקודת האיסוף?" })).toHaveCount(0);
  await expect(app(page).locator('.location-button[data-pickup-location-id="pitzutz"]')).toHaveAttribute(
    "aria-pressed",
    "true",
  );
});

test("direct pickup navigation selects the first location with waiting packages only", async ({
  page,
}) => {
  await gotoAdmin(page);

  await clickPhoneNav(page, "איסוף");
  await expect(app(page).getByRole("heading", { name: "איסוף בחנות" })).toBeVisible();

  await expect(app(page).locator('.location-button[data-pickup-location-id="pitzutz"]')).toHaveAttribute(
    "aria-pressed",
    "true",
  );
  await expect(app(page).locator('.location-button[data-pickup-location-id="eshkolot"]')).toHaveAttribute(
    "aria-pressed",
    "false",
  );

  await app(page).locator('.location-button[data-pickup-location-id="eshkolot"]').click();
  await expect(page.getByRole("status")).toContainText(
    "אין כרגע חבילות שממתינות לאיסוף בנקודה הזאת.",
  );
  await expect(app(page).locator('.location-button[data-pickup-location-id="eshkolot"]')).toHaveAttribute(
    "aria-pressed",
    "false",
  );
  await expect(app(page).locator('.location-button[data-pickup-location-id="pitzutz"]')).toHaveAttribute(
    "aria-pressed",
    "true",
  );
});

test("pickup flow reveals original messages only after confirmation and records collection", async ({
  context,
  page,
}) => {
  await gotoAdmin(page);
  await clickPhoneNav(page, "איסוף");

  await app(page).locator('.location-button[data-pickup-location-id="eshkolot"]').click();
  await expect(page.getByRole("status")).toContainText(
    "אין כרגע חבילות שממתינות לאיסוף בנקודה הזאת",
  );
  await expect(page.getByRole("dialog", { name: "האם אתה כבר בנקודת האיסוף?" })).toHaveCount(0);
  await expect(app(page)).not.toContainText("הודעה מקורית מחברת המשלוחים");

  await app(page).locator('.location-button[data-pickup-location-id="pitzutz"]').click();
  const confirmDialog = page.getByRole("dialog", { name: "האם אתה כבר בנקודת האיסוף?" });
  await expect(confirmDialog).toBeVisible();
  await expect(confirmDialog).toHaveCSS("direction", "rtl");
  await expect(confirmDialog).toContainText(
    "כדי לפתוח הודעות משלוח וקישורים יש לאשר שאתה נמצא עכשיו בנקודת האיסוף",
  );
  await confirmDialog.getByRole("button", { name: "אשר" }).click();

  await expect(app(page).getByText("איסוף בחנות")).toBeVisible();
  await expect(app(page).getByText("הודעה מקורית מחברת המשלוחים").first()).toBeVisible();
  const firstCatalogCard = app(page).locator(".catalog-card").first();
  const catalogWhatsApp = firstCatalogCard.getByRole("link", {
    name: "פתח ווטסאפ עם עוז כרמל",
  });
  await expect(catalogWhatsApp).toHaveAttribute("href", "https://wa.me/972584411883");
  const pickupLink = app(page).getByRole("link", { name: /https:\/\/u\.cheetahint\.com/ }).first();
  await expect(pickupLink).toHaveAttribute("href", /https:\/\/u\.cheetahint\.com/);
  const selfCollectToggle = firstCatalogCard.locator(".collect-button");
  await expect(selfCollectToggle).toBeEnabled();
  await expect(selfCollectToggle).toHaveAttribute("aria-pressed", "false");
  await expect(selfCollectToggle).toHaveText("לחץ לאיסוף");

  const popupPromise = context.waitForEvent("page");
  await pickupLink.click();
  const popup = await popupPromise;
  await popup.close();
  await page.bringToFront();
  await page.evaluate(() => window.dispatchEvent(new Event("focus")));
  await expect(selfCollectToggle).toBeEnabled();
  await expect(selfCollectToggle).toHaveAttribute("aria-pressed", "true");
  await expect(selfCollectToggle).toContainText("נמסרה בקיבוץ");
  await selfCollectToggle.click();
  await expect(selfCollectToggle).toHaveAttribute("aria-pressed", "false");
  await expect(selfCollectToggle).toHaveText("לחץ לאיסוף");
  await selfCollectToggle.click();
  await expect(selfCollectToggle).toHaveAttribute("aria-pressed", "true");
  await expect(selfCollectToggle).toContainText("נמסרה בקיבוץ");

  const otherCatalogCard = app(page).locator(".catalog-card").filter({ hasText: "הילה נבו" });
  const collectToggle = otherCatalogCard.locator(".collect-button");
  await expect(collectToggle).toHaveText("לחץ לאיסוף");
  await collectToggle.click();
  await expect(collectToggle).toHaveAttribute("aria-pressed", "true");
  await expect(collectToggle).toHaveText("נאספה");
  await collectToggle.click();
  await expect(collectToggle).toHaveAttribute("aria-pressed", "false");
  await expect(collectToggle).toHaveText("לחץ לאיסוף");
  await collectToggle.click();
  await expect(collectToggle).toHaveAttribute("aria-pressed", "true");
  await expect(catalogWhatsApp).toBeVisible();

  await clickPhoneNav(page, "בית");
  const selfDeliveredHomeCard = app(page)
    .locator(".package-card")
    .filter({ has: page.getByText("עוז כרמל", { exact: true }) });
  await expect(selfDeliveredHomeCard).not.toContainText("אצל בעל החבילה");
  await expect(app(page).getByText(/נאספה על ידי/).first()).toBeVisible();
  const collectedHomeCard = app(page).locator(".package-card").filter({ hasText: "הילה נבו" });
  const collectedHomeWhatsApp = collectedHomeCard.getByRole("link", {
    name: "פתח ווטסאפ עם הילה נבו",
  });
  await expect(collectedHomeWhatsApp).toHaveCSS("align-self", "flex-start");
  await expect(collectedHomeWhatsApp).toHaveCSS("margin-top", "2px");

  await collectedHomeCard.getByRole("button", { name: "נאספה" }).click();
  await expect(app(page).getByRole("heading", { name: "החבילות הגיעו" })).toBeVisible();
  await expect(app(page).getByText("אלה החבילות שמחכות לעדכון מיקום בקיבוץ")).toBeVisible();
  const arrivalCard = app(page).locator(".arrival-package-card").first();
  await expect(arrivalCard).toBeVisible();
  const dropLocation = arrivalCard.locator("select[id^='drop-location-']");
  await expect(dropLocation).toHaveValue("gate-crate");
  await expect(dropLocation.locator("option")).toHaveText(["דולב ש.ג", "כלבו", "אחר"]);
  await expect(arrivalCard.getByText("הערה למסירה", { exact: true })).toHaveCount(0);
  await expect(arrivalCard.locator("input[id^='drop-other-']")).toHaveCount(0);

  await dropLocation.selectOption("other");
  const otherLocation = arrivalCard.locator("input[id^='drop-other-']");
  await expect(otherLocation).toBeVisible();
  await expect(otherLocation).not.toHaveAttribute("placeholder");
  await expect(otherLocation).toHaveAttribute("maxlength", "40");
  await expect(arrivalCard.locator(".arrival-package-submit")).toBeDisabled();
  await otherLocation.fill("ליד המזכירות");
  await expect(arrivalCard.locator(".arrival-package-submit")).toBeEnabled();

  await dropLocation.selectOption("gate-crate");
  await expect(otherLocation).toHaveCount(0);
  await arrivalCard.locator(".arrival-package-submit").click();
  await expect(page.getByRole("status")).toContainText("החבילה נמסרה בקיבוץ");
  await clickPhoneNav(page, "בית");
  await expect(app(page).getByText("שמתי בדולב").first()).toBeVisible();
});

test("multiple kibbutz delivery rows are collapsed until a package name is opened", async ({
  page,
}) => {
  await gotoAdmin(page);
  await clickPhoneNav(page, "איסוף");

  await app(page).locator('.location-button[data-pickup-location-id="pitzutz"]').click();
  await page.getByRole("dialog", { name: "האם אתה כבר בנקודת האיסוף?" }).getByRole("button", { name: "אשר" }).click();
  await expect(app(page).getByText("איסוף בחנות")).toBeVisible();

  const catalogCards = app(page).locator(".catalog-card");
  await expect(catalogCards).toHaveCount(3);

  await catalogCards.nth(1).locator(".collect-button").click();
  await catalogCards.nth(2).locator(".collect-button").click();

  await clickPhoneNav(page, "מסירה");
  await expect(app(page).getByRole("heading", { name: "החבילות הגיעו" })).toBeVisible();

  const arrivalCards = app(page).locator(".arrival-package-card");
  await expect(arrivalCards).toHaveCount(2);
  await expect(arrivalCards.nth(0).locator(".arrival-package-toggle")).toHaveAttribute(
    "aria-expanded",
    "false",
  );
  await expect(arrivalCards.nth(1).locator(".arrival-package-toggle")).toHaveAttribute(
    "aria-expanded",
    "false",
  );
  await expect(app(page).locator("select[id^='drop-location-']")).toHaveCount(0);

  await arrivalCards.nth(0).locator(".arrival-package-toggle").click();
  await expect(arrivalCards.nth(0).locator("select[id^='drop-location-']")).toBeVisible();
  await expect(arrivalCards.nth(0).locator(".arrival-package-submit")).toBeVisible();
  await expect(arrivalCards.nth(1).locator("select[id^='drop-location-']")).toHaveCount(0);

  await arrivalCards.nth(1).locator(".arrival-package-toggle").click();
  await expect(arrivalCards.nth(1).locator("select[id^='drop-location-']")).toBeVisible();
  await expect(arrivalCards.nth(1).locator(".arrival-package-submit")).toBeVisible();
});

test("home and form UI avoid the known layout regressions", async ({ page }) => {
  await gotoFreshUser(page);
  await expectNoVerticalOverlap(app(page), ".join-stack .field");

  await gotoAdmin(page);
  await expect(app(page).locator(".content-home")).toHaveCSS("overflow-y", "hidden");
  await expect(app(page).locator(".home-list")).toHaveCSS("overflow-y", "auto");
  await expect.poll(async () => app(page).locator(".pickup-card").count()).toBeGreaterThan(0);
  await expect(app(page).locator(".pickup-card").first()).toHaveCSS("cursor", "pointer");
  await expect(app(page).locator(".package-card").filter({ hasText: "נמסרה בקיבוץ" })).toBeVisible();

  const statusColors = await app(page).locator(".content-home").evaluate((home) => {
    const style = (selector: string) =>
      getComputedStyle(home.querySelector(selector) as Element).backgroundColor;

    return {
      topWaiting: style(".home-status-waiting"),
      packageWaiting: style(".package-card .badge.waiting"),
      topArrived: style(".home-status-arrived"),
      packageArrived: style(".package-card .badge.arrived"),
    };
  });
  expect(statusColors.topWaiting).toBe(statusColors.packageWaiting);
  expect(statusColors.topArrived).toBe(statusColors.packageArrived);

  await expect(app(page).locator(".home-status-waiting")).toHaveAttribute("title", /ממתינות לאיסוף/);
  const homeStatusLabelBox = await app(page)
    .locator(".home-status-label")
    .first()
    .evaluate((label) => {
      const rect = label.getBoundingClientRect();
      const styles = getComputedStyle(label);

      return {
        height: rect.height,
        position: styles.position,
        width: rect.width,
      };
    });
  expect(homeStatusLabelBox.position).toBe("absolute");
  expect(homeStatusLabelBox.width).toBeLessThanOrEqual(1);
  expect(homeStatusLabelBox.height).toBeLessThanOrEqual(1);

  const packageStatusBadgeStyles = await app(page).locator(".content-home").evaluate((home) => {
    const style = (selector: string) => {
      const element = home.querySelector(selector) as HTMLElement;
      const styles = getComputedStyle(element);
      const rect = (home.querySelector(selector) as HTMLElement).getBoundingClientRect();

      return {
        fontSize: styles.fontSize,
        height: Math.round(rect.height),
        width: Math.round(rect.width),
      };
    };

    return {
      waiting: style(".package-card .status-action-badge"),
      arrived: style(".package-card .badge.arrived"),
    };
  });
  expect(packageStatusBadgeStyles.waiting).toEqual(packageStatusBadgeStyles.arrived);

  await openAdmin(page);
  await app(page).getByRole("button", { name: /הוסף נקודת איסוף/ }).click();
  const closedLocationDialog = page.getByRole("dialog", { name: "הוסף נקודת איסוף" });
  await closedLocationDialog.getByLabel("שם נקודת איסוף").fill("נקודת סגורה");
  await closedLocationDialog.getByLabel("כתובת מלאה או תיאור מקום").fill("בדיקת צבע סגור");
  await closedLocationDialog.getByLabel("שעות פתיחה לתצוגה").fill("יום אחר 08:00-13:00");
  const closedDayLabel = weekdayLabels[(new Date().getDay() + 1) % weekdayLabels.length];
  await closedLocationDialog
    .locator(".hours-day-row")
    .filter({ hasText: closedDayLabel })
    .getByRole("checkbox")
    .first()
    .check();
  await closedLocationDialog.getByRole("button", { name: /הוסף/ }).click();
  await expect(closedLocationDialog).toBeHidden();

  await clickPhoneNav(page, "בית");
  await expect(app(page).locator(".pickup-card-closed").filter({ hasText: "נקודת סגורה" })).toBeVisible();

  const iconOverlap = await app(page).locator(".pickup-card-group").evaluateAll((groups) =>
    groups.some((group) => {
      const icon = group.querySelector(".opening-hours-icon-button");
      const text = group.querySelector(".pickup-card span");
      if (!icon || !text) return false;

      const iconRect = icon.getBoundingClientRect();
      const textRect = text.getBoundingClientRect();
      return !(
        iconRect.right <= textRect.left ||
        iconRect.left >= textRect.right ||
        iconRect.bottom <= textRect.top ||
        iconRect.top >= textRect.bottom
      );
    }),
  );
  expect(iconOverlap).toBe(false);

  const arrowStyle = await app(page)
    .locator(".location-more-indicator")
    .evaluate((element) => {
      const styles = getComputedStyle(element);
      const rect = element.getBoundingClientRect();

      return {
        backgroundColor: styles.backgroundColor,
        width: rect.width,
      };
    });
  expect(arrowStyle.backgroundColor).toMatch(/rgba\([^)]*,\s*0(?:\.0+)?\)/);
  expect(arrowStyle.width).toBeLessThanOrEqual(14);

  await clickPhoneNav(page, "הוספה");
  await expectNoVerticalOverlap(app(page), "form.stack .field");

  await openAdmin(page);
  await app(page).getByRole("button", { name: /הוסף נקודת איסוף/ }).click();
  const addLocationDialog = page.getByRole("dialog", { name: "הוסף נקודת איסוף" });
  await expect(addLocationDialog).toHaveCSS("direction", "rtl");
  await expectNoVerticalOverlap(addLocationDialog, ".location-admin-form > .field");
});

test("home package cards open the submitter WhatsApp without changing package state", async ({
  page,
  runtimeErrors,
}) => {
  await gotoAdmin(page);

  const hilaCard = app(page).locator(".package-card").filter({ hasText: "הילה נבו" });
  const hilaWhatsApp = hilaCard.getByRole("link", { name: "פתח ווטסאפ עם הילה נבו" });
  await expect(hilaWhatsApp).toHaveAttribute("href", "https://wa.me/972502222222");
  await expect
    .poll(async () => {
      const linkBox = await hilaWhatsApp.boundingBox();
      const iconBox = await hilaWhatsApp.locator("svg").boundingBox();
      return {
        link: linkBox ? [linkBox.width, linkBox.height] : null,
        icon: iconBox ? [iconBox.width, iconBox.height] : null,
      };
    })
    .toEqual({ link: [44, 44], icon: [38, 38] });

  const ownCard = app(page).locator(".package-card").filter({ hasText: "עוז כרמל" });
  await expect(
    ownCard.getByRole("link", { name: "פתח ווטסאפ עם עוז כרמל" }),
  ).toHaveAttribute("href", "https://wa.me/972584411883");
  await expect(ownCard.locator(".package-remove-button .lucide-trash-2")).toBeVisible();

  const missingContactCard = app(page).locator(".package-card").filter({ hasText: "איילת מדר" });
  await expect(missingContactCard.locator(".package-icon")).toBeVisible();
  await expect(missingContactCard.locator(".package-whatsapp-link")).toHaveCount(0);

  const statusCountsBefore = await readHomeStatusCounts(page);
  const popupPromise = page.waitForEvent("popup");
  await hilaWhatsApp.click();
  const whatsappPage = await popupPromise;
  await whatsappPage.close();

  await expect.poll(() => readHomeStatusCounts(page)).toEqual(statusCountsBefore);
  expect(runtimeErrors).toEqual([]);
});
