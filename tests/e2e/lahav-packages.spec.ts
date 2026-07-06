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
  delivered: number;
};

async function readHomeStatusCounts(page: Page): Promise<StatusCounts> {
  return {
    waiting: await readHomeStatusCount(page, "home-status-waiting"),
    collected: await readHomeStatusCount(page, "home-status-collected"),
    arrived: await readHomeStatusCount(page, "home-status-arrived"),
    delivered: await readHomeStatusCount(page, "home-status-delivered"),
  };
}

async function readPackageListStatusCounts(page: Page): Promise<StatusCounts> {
  return app(page).locator(".package-card").evaluateAll((cards) => {
    const counts = {
      waiting: 0,
      collected: 0,
      arrived: 0,
      delivered: 0,
    };

    cards.forEach((card) => {
      const statusElement = card.querySelector(
        ".status-action-badge, .badge.waiting, .badge.blue, .badge.arrived, .badge.delivered",
      );
      const text = statusElement?.textContent ?? "";

      if (text.includes("ממתינה לאיסוף")) counts.waiting += 1;
      if (text.includes("נאספה")) counts.collected += 1;
      if (text.includes("הגיעה לקיבוץ")) counts.arrived += 1;
      if (text.includes("נמסרה")) counts.delivered += 1;
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
  await expect(app(page).locator(".home-status-delivered strong")).toHaveText(
    String(expected.delivered),
    { timeout: 5000 },
  );
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
  await catalogCard.getByRole("button", { name: "סמן נאספה" }).click();
  await expect(catalogCard.getByRole("button", { name: "נאספה" })).toHaveAttribute(
    "aria-pressed",
    "true",
  );
}

async function openPickupApprovalLinkIfPresent(context: BrowserContext, card: Locator) {
  const pickupLink = card.locator(".pickup-link-button");
  if ((await pickupLink.count()) === 0) return;

  const popupPromise = context.waitForEvent("page");
  await pickupLink.click();
  const popup = await popupPromise;
  await popup.close();
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

test("admin can approve pending users and approved users appear as regular members", async ({ page }) => {
  await gotoAdmin(page);
  await expect(app(page).locator(".bottom-nav button")).toHaveCount(4);
  await expect(app(page).locator(".bottom-nav").getByRole("button", { name: "מסירה" })).toBeEnabled();
  await clickPhoneNav(page, "מסירה");
  await expect(app(page).getByRole("heading", { name: "החבילות הגיעו" })).toBeVisible();
  await expect(app(page)).toContainText("אין כרגע חבילות שסומנו כנאספו על ידך.");
  await expect(app(page).getByRole("button", { name: /עדכן מיקום/ })).toBeDisabled();
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
    app(page).getByText(
      "כאן ניתן לצפות בחבילות שהוספו בעבר ולערוך את פרטי החבילה אם עוד לא נאספה",
    ),
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
  await expect(app(page).locator(".home-status-band")).toContainText("הגיעו לקיבוץ");
  await expect(app(page).locator(".home-status-band")).toContainText("נמסרו");
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
  await expect(page.getByRole("dialog", { name: "הגיעו לקיבוץ" })).toBeVisible();
  await expect(page.locator(".status-bottom-sheet")).toContainText("נעה אמבולוס");
  await page.getByRole("button", { name: "סגור" }).click();

  await app(page).locator(".home-status-delivered").click();
  await expect(page.getByRole("dialog", { name: "נמסרו" })).toBeVisible();
  await expect(page.locator(".status-bottom-sheet")).toContainText(
    "אין חבילות בסטטוס הזה כרגע.",
  );
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
  await mosheCard.getByRole("button", { name: "סמן נאספה" }).click();
  await expect(mosheCard.getByRole("button", { name: "נאספה" })).toHaveAttribute(
    "aria-pressed",
    "true",
  );

  await clickPhoneNav(page, "בית");
  await expect(app(page).getByRole("heading", { name: "מה מצב החבילות?" })).toBeVisible();
  await expect(app(page).locator(".package-list")).toContainText("משה בדואר", {
    timeout: 5000,
  });
  await expect(app(page).locator(".package-list")).toContainText("בונו בפיצוץ", {
    timeout: 5000,
  });
  await expect(app(page).locator(".package-list")).toContainText("נאספה");
  await expect(app(page).locator(".package-list")).toContainText("ממתינה לאיסוף");
});

test("multi-package lifecycle keeps home counters, pickup counts, and package statuses synchronized", async ({
  context,
  page,
}) => {
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

  await collectPackageAtLocation(context, page, "post-office", "זרימה דואר אחת");
  await collectPackageAtLocation(context, page, "pitzutz", "זרימה פיצוץ אחת");
  await collectPackageAtLocation(context, page, "deli-place", "זרימה דלי");

  await clickPhoneNav(page, "בית");
  await expectHomeStatusSync(page, {
    ...baseline,
    waiting: baseline.waiting + 3,
    collected: baseline.collected + 3,
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
  await expectPackageCardStatus(page, "זרימה דואר אחת", "נאספה");
  await expectPackageCardStatus(page, "זרימה דואר שתיים", "ממתינה לאיסוף");
  await expectPackageCardStatus(page, "זרימה פיצוץ אחת", "נאספה");
  await expectPackageCardStatus(page, "זרימה פיצוץ שתיים", "ממתינה לאיסוף");
  await expectPackageCardStatus(page, "זרימה אשכולות", "ממתינה לאיסוף");
  await expectPackageCardStatus(page, "זרימה דלי", "נאספה");

  await clickPhoneNav(page, "מסירה");
  await expect(app(page).getByRole("heading", { name: "החבילות הגיעו" })).toBeVisible();
  const deliveryTargets = [
    { name: "זרימה דואר אחת", dropLocation: "gate-crate", note: "שמתי בדולב" },
    { name: "זרימה פיצוץ אחת", dropLocation: "kolbo", note: "שמתי בארון הכלבו למעלה" },
    { name: "זרימה דלי", dropLocation: "collector-home", note: "מוזמנים לקחת ממני, שמתי ליד הדלת" },
  ];

  for (const target of deliveryTargets) {
    const arrivalCard = app(page).locator(".arrival-package-card").filter({ hasText: target.name });
    await expect(arrivalCard).toBeVisible();
    await arrivalCard.locator(".arrival-package-toggle").click();
    await arrivalCard.locator("select[id^='drop-location-']").selectOption(target.dropLocation);
  }
  await app(page).getByRole("button", { name: /עדכן מיקום/ }).click();

  await expect(page.getByRole("status")).toContainText("מיקום החבילות בקיבוץ עודכן");
  await expect(app(page).getByRole("heading", { name: "מה מצב החבילות?" })).toBeVisible();
  await expectHomeStatusSync(page, {
    ...baseline,
    waiting: baseline.waiting + 3,
    collected: baseline.collected,
    arrived: baseline.arrived + 3,
  });
  for (const target of deliveryTargets) {
    await expectPackageCardStatus(page, target.name, "הגיעה לקיבוץ");
    await expect(app(page).locator(".package-card").filter({ hasText: target.name })).toContainText(
      target.note,
    );
  }

  const receivedCard = app(page).locator(".package-card").filter({ hasText: "זרימה דואר אחת" });
  await receivedCard.getByRole("button", { name: "אשר קבלה" }).click();
  await expect(receivedCard.getByRole("button", { name: "התקבלה" })).toBeVisible();
  await expectHomeStatusSync(page, {
    ...baseline,
    waiting: baseline.waiting + 3,
    collected: baseline.collected,
    arrived: baseline.arrived + 2,
    delivered: baseline.delivered + 1,
  });
  await expectPackageCardStatus(page, "זרימה דואר אחת", "נמסרה");

  await collectPackageAtLocation(context, page, "post-office", "זרימה דואר שתיים");

  await clickPhoneNav(page, "בית");
  await expectHomeStatusSync(page, {
    ...baseline,
    waiting: baseline.waiting + 2,
    collected: baseline.collected + 1,
    arrived: baseline.arrived + 2,
    delivered: baseline.delivered + 1,
  });
  await expect(app(page).locator('.pickup-card[data-pickup-location-id="post-office"] strong')).toHaveText(
    String(baselinePickupCounts.postOffice),
  );
  await expectPackageCardStatus(page, "זרימה דואר שתיים", "נאספה");
  await expectPackageCardStatus(page, "זרימה פיצוץ שתיים", "ממתינה לאיסוף");
  await expectPackageCardStatus(page, "זרימה אשכולות", "ממתינה לאיסוף");
  await expectPackageCardStatus(page, "זרימה פיצוץ אחת", "הגיעה לקיבוץ");
  await expectPackageCardStatus(page, "זרימה דלי", "הגיעה לקיבוץ");
  await expectPackageCardStatus(page, "זרימה דואר אחת", "נמסרה");
});

test("saving two kibbutz delivery rows updates home status and shows both packages", async ({
  context,
  page,
}) => {
  await gotoAdmin(page);

  await clickPhoneNav(page, "הוספה");
  await app(page).getByLabel("שם מקבל החבילה").fill("בדיקת מסירה אשכולות");
  await app(page).locator("#pickup-location").selectOption("eshkolot");
  await app(page)
    .getByLabel("הודעת המשלוח המקורית")
    .fill("משלוח ESH-001 ממתין לאיסוף באשכולות. קוד 111222.");
  await app(page).getByRole("button", { name: /הוסף חבילה/ }).click();
  await clickPhoneNav(page, "בית");
  await expect(app(page).getByRole("heading", { name: "מה מצב החבילות?" })).toBeVisible();

  const beforeArrivedCount = await readHomeStatusCount(page, "home-status-arrived");
  const collectedNames: string[] = [];

  async function collectFirstPackageAtLocation(locationId: string) {
    await clickPhoneNav(page, "איסוף");
    await app(page).locator(`.location-button[data-pickup-location-id="${locationId}"]`).click();
    await page
      .getByRole("dialog", { name: "האם אתה כבר בנקודת האיסוף?" })
      .getByRole("button", { name: "אשר" })
      .click();
    await expect(app(page).getByText("איסוף בחנות")).toBeVisible();

    const catalogCard = app(page).locator(".catalog-card").first();
    const packageName = ((await catalogCard.locator(".package-name").textContent()) ?? "").trim();
    await openPickupApprovalLinkIfPresent(context, catalogCard);
    await catalogCard.getByRole("button", { name: "סמן נאספה" }).click();
    await expect(catalogCard.getByRole("button", { name: "נאספה" })).toHaveAttribute(
      "aria-pressed",
      "true",
    );
    return packageName;
  }

  collectedNames.push(await collectFirstPackageAtLocation("pitzutz"));
  collectedNames.push(await collectFirstPackageAtLocation("eshkolot"));

  await clickPhoneNav(page, "מסירה");
  await expect(app(page).getByRole("heading", { name: "החבילות הגיעו" })).toBeVisible();

  const arrivalCards = app(page).locator(".arrival-package-card");
  await expect(arrivalCards).toHaveCount(2);

  await arrivalCards.nth(0).locator(".arrival-package-toggle").click();
  await arrivalCards.nth(1).locator(".arrival-package-toggle").click();
  await arrivalCards.nth(0).locator("select[id^='drop-location-']").selectOption("gate-crate");
  await arrivalCards.nth(1).locator("select[id^='drop-location-']").selectOption("kolbo");
  await app(page).getByRole("button", { name: /עדכן מיקום/ }).click();

  await expect(page.getByRole("status")).toContainText("מיקום החבילות בקיבוץ עודכן");
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
                  (card.textContent ?? "").includes("הגיעה לקיבוץ")
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

test("home waiting package shortcuts open pickup screen with the location selected", async ({
  page,
}) => {
  await gotoAdmin(page);

  await app(page).locator('.pickup-card[data-pickup-location-id="pitzutz"]').click();
  await expect(app(page).getByRole("heading", { name: "אני נוסע לאסוף" })).toBeVisible();
  await expect(page.getByRole("dialog", { name: "האם אתה כבר בנקודת האיסוף?" })).toHaveCount(0);
  await expect(app(page).locator('.location-button[data-pickup-location-id="pitzutz"]')).toHaveAttribute(
    "aria-pressed",
    "true",
  );

  await clickPhoneNav(page, "בית");
  await app(page).locator(".status-action-badge").first().click();
  await expect(app(page).getByRole("heading", { name: "אני נוסע לאסוף" })).toBeVisible();
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
  await expect(app(page).getByRole("heading", { name: "אני נוסע לאסוף" })).toBeVisible();

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
  await confirmDialog.getByRole("button", { name: "אשר" }).click();

  await expect(app(page).getByText("איסוף בחנות")).toBeVisible();
  await expect(app(page).getByText("הודעה מקורית מחברת המשלוחים").first()).toBeVisible();
  const pickupLink = app(page).getByRole("link", { name: /https:\/\/u\.cheetahint\.com/ }).first();
  await expect(pickupLink).toHaveAttribute("href", /https:\/\/u\.cheetahint\.com/);

  const popupPromise = context.waitForEvent("page");
  await pickupLink.click();
  const popup = await popupPromise;
  await popup.close();
  await expect(page.getByRole("status")).toContainText("קישור האישור נפתח");

  await app(page).locator(".catalog-card").first().getByRole("button", { name: "נאספה" }).click();
  await expect(app(page).locator(".catalog-card").first().getByRole("button", { name: "נאספה" })).toHaveAttribute(
    "aria-pressed",
    "true",
  );

  await clickPhoneNav(page, "בית");
  await expect(app(page).getByText(/נאספה על ידי/).first()).toBeVisible();

  await clickPhoneNav(page, "מסירה");
  await expect(app(page).getByRole("heading", { name: "החבילות הגיעו" })).toBeVisible();
  await expect(app(page).getByText("אלה החבילות שמחכות לעדכון מיקום בקיבוץ")).toBeVisible();
  const arrivalCard = app(page).locator(".arrival-package-card").first();
  await expect(arrivalCard).toBeVisible();
  const dropNote = arrivalCard.locator("textarea[id^='drop-note-']");
  const dropLocation = arrivalCard.locator("select[id^='drop-location-']");
  await expect(dropNote).toHaveValue("");
  await expect(dropNote).toHaveAttribute("placeholder", "שמתי בדולב");
  await dropLocation.selectOption("kolbo");
  await expect(dropNote).toHaveValue("");
  await expect(dropNote).toHaveAttribute("placeholder", "שמתי בארון הכלבו למעלה");
  await dropLocation.selectOption("collector-home");
  await expect(dropNote).toHaveValue("");
  await expect(dropNote).toHaveAttribute("placeholder", "מוזמנים לקחת ממני, שמתי ליד הדלת");
  await dropLocation.selectOption("direct-home");
  await expect(dropNote).toHaveValue("");
  await expect(dropNote).toHaveAttribute("placeholder", "");
  await dropNote.fill("השארתי ליד המזכירות");
  await expect(dropNote).toHaveValue("השארתי ליד המזכירות");

  await dropLocation.selectOption("gate-crate");
  await dropNote.fill("");
  await app(page).getByRole("button", { name: /עדכן מיקום/ }).click();
  await expect(page.getByRole("status")).toContainText("מיקום החבילות בקיבוץ עודכן");
  await expect(app(page).getByText("שמתי בדולב").first()).toBeVisible();
});

test("multiple kibbutz delivery rows are collapsed until a package name is opened", async ({
  context,
  page,
}) => {
  await gotoAdmin(page);
  await clickPhoneNav(page, "איסוף");

  await app(page).locator('.location-button[data-pickup-location-id="pitzutz"]').click();
  await page.getByRole("dialog", { name: "האם אתה כבר בנקודת האיסוף?" }).getByRole("button", { name: "אשר" }).click();
  await expect(app(page).getByText("איסוף בחנות")).toBeVisible();

  const catalogCards = app(page).locator(".catalog-card");
  await expect(catalogCards).toHaveCount(3);

  const popupPromise = context.waitForEvent("page");
  await catalogCards.nth(0).getByRole("link", { name: /https:\/\/u\.cheetahint\.com/ }).click();
  const popup = await popupPromise;
  await popup.close();
  await catalogCards.nth(0).getByRole("button", { name: "סמן נאספה" }).click();
  await catalogCards.nth(1).getByRole("button", { name: "סמן נאספה" }).click();

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
  await expect(arrivalCards.nth(1).locator("select[id^='drop-location-']")).toHaveCount(0);

  await arrivalCards.nth(1).locator(".arrival-package-toggle").click();
  await expect(arrivalCards.nth(1).locator("select[id^='drop-location-']")).toBeVisible();
});

test("home and form UI avoid the known layout regressions", async ({ page }) => {
  await gotoFreshUser(page);
  await expectNoVerticalOverlap(app(page), ".join-stack .field");

  await gotoAdmin(page);
  await expect(app(page).locator(".content-home")).toHaveCSS("overflow-y", "hidden");
  await expect(app(page).locator(".home-list")).toHaveCSS("overflow-y", "auto");
  await expect.poll(async () => app(page).locator(".pickup-card").count()).toBeGreaterThan(0);
  await expect(app(page).locator(".pickup-card").first()).toHaveCSS("cursor", "pointer");
  await expect(app(page).locator(".package-card").filter({ hasText: "הגיעה לקיבוץ" })).toBeVisible();

  const statusColors = await app(page).locator(".content-home").evaluate((home) => {
    const style = (selector: string) =>
      getComputedStyle(home.querySelector(selector) as Element).backgroundColor;

    return {
      topWaiting: style(".home-status-waiting"),
      packageWaiting: style(".package-card .badge.waiting"),
      topArrived: style(".home-status-arrived"),
      packageArrived: style(".package-card .badge.arrived"),
      topDelivered: style(".home-status-delivered"),
    };
  });
  expect(statusColors.topWaiting).toBe(statusColors.packageWaiting);
  expect(statusColors.topArrived).toBe(statusColors.packageArrived);
  expect(statusColors.topDelivered).not.toBe(statusColors.topArrived);

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
