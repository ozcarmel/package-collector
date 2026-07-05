import { expect, test as base, type Locator, type Page } from "@playwright/test";

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
  await expect(page.getByRole("status")).toContainText("אין חבילות למסירה כרגע");
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
    "הדביקו כאן במלואה את ההודעה שקיבלתם ב-SMS או במייל, כולל קוד וקישור",
  );

  await app(page).getByRole("button", { name: /שמור/ }).click();
  await expect(page.getByRole("status")).toContainText("יש להזין את שם מקבל החבילה");
  await expect(ownerInput).toBeVisible();

  await ownerInput.fill("עוז כרמל");
  await app(page).getByRole("button", { name: /שמור/ }).click();
  await expect(page.getByRole("status")).toContainText("יש להדביק את הודעת חברת המשלוחים");
  await expect(messageInput).toBeVisible();

  await messageInput.fill(
    "שלום עוז, משלוח AE04062389 ממתין לאיסוף בפיצוץ להבים. לאישור איסוף לחצו: https://u.cheetahint.com/vknpgt0",
  );
  await app(page).getByRole("button", { name: /שמור/ }).click();

  await expect(app(page).getByRole("heading", { name: "מה מצב החבילות?" })).toBeVisible();
  await expect(app(page).locator(".package-list").first()).toContainText("עוז כרמל");
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
    await app(page).getByRole("button", { name: /שמור/ }).click();

    await expect(app(page).getByRole("heading", { name: "מה מצב החבילות?" })).toBeVisible();
    await expect(
      app(page).locator(`.pickup-card[data-pickup-location-id="${locationId}"] strong`),
    ).toHaveText(String(beforeCount + 1));
    await expect(app(page).locator(".package-list").first()).toContainText(`בדיקה ${locationId}`);
  }
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

test("home and form UI avoid the known layout regressions", async ({ page }) => {
  await gotoFreshUser(page);
  await expectNoVerticalOverlap(app(page), ".join-stack .field");

  await gotoAdmin(page);
  await expect(app(page).locator(".content-home")).toHaveCSS("overflow-y", "hidden");
  await expect(app(page).locator(".home-list")).toHaveCSS("overflow-y", "auto");
  await expect.poll(async () => app(page).locator(".pickup-card-open").count()).toBeGreaterThan(0);

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
