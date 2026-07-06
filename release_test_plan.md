# Lahav Packages Release Test Plan

## Purpose

This document is the release gate for the Lahav Packages pilot. It focuses on the flows that can block real community use: joining, admin approval, adding packages, pickup access, delivery, package receipt, pickup-location management, and Firebase permissions.

The public pilot URL is:

`https://ozcarmel.github.io/package-collector/`

## Release Rule

Do not share the app broadly unless the critical release gate passes.

For a small pilot of about 30 users, it is acceptable to release after the critical gate passes, even if lower-priority polish items remain documented.

## Critical Release Gate

Run these commands before a release:

```bash
npm run lint
npm run typecheck
npm test -- --run
npm run test:rules
npm run test:e2e
npm run build
```

Current known note: `npm run test:rules` requires the Firebase emulator port to be free. If the command fails because the Firestore emulator port is already occupied, stop the other emulator process or change the emulator port before treating the result as a real rules failure.

## Production Smoke Flow

This flow checks the exact scenario expected when sharing the public link in the Lahav WhatsApp group.

1. Open `https://ozcarmel.github.io/package-collector/` as a fresh user.
2. The user sees the join screen, not the development explanation page.
3. The user enters full name and mobile phone.
4. The user submits a join request.
5. The user lands on the pending approval screen.
6. The pending user cannot add a package.
7. The pending user cannot start pickup.
8. Oz opens the same public URL as admin.
9. Oz sees the pending user in `ניהול`.
10. Oz approves the user.
11. The approved user reaches the home screen.
12. The approved user can add a package.
13. The package appears under the correct pickup location.

## Most Important Use Cases

### New User Approval

Risk: unapproved people can use the app before Oz approves them.

Expected:

- A fresh user can submit a join request.
- A pending user only sees the pending state.
- A pending user cannot add packages.
- A pending user cannot collect packages.
- After Oz approves the user, the user can use the app.

### Admin Permissions

Risk: someone other than Oz can promote managers or remove managers.

Expected:

- Only `עוז כרמל`, phone `0584411883`, is the owner.
- Only Oz can promote users to manager.
- Only Oz can block or remove managers.
- Other managers can approve or reject pending users.
- Other managers can block regular approved users.
- Nobody can block themselves.
- Blocking means setting `verificationStatus: "blocked"`, not deleting history.

### Package Creation

Risk: a package is saved under the wrong pickup location.

Expected:

- A user chooses a pickup location manually.
- The package count increases only for that selected location.
- The original delivery-company message is stored.
- The sensitive original message is not exposed publicly on the home screen.

### Pickup Access

Risk: collectors can see sensitive package messages too early, or can open empty pickup locations.

Expected:

- A location with zero waiting packages does not open the confirmation popup.
- A location with waiting packages opens the RTL confirmation popup.
- Only after confirming presence at the pickup point does the collector see original package messages.
- Original links in delivery-company messages are clickable.
- Marking `נאספה` stores the collector identity.

### Delivery And Receipt

Risk: packages disappear without a clear audit trail.

Expected:

- A collected package appears in the delivery flow for the collector.
- The package owner can mark `אשר קבלה`.
- After confirmation, the button changes to `התקבלה`.
- Delivered packages disappear from the home list after the configured delay.
- Admin can still review who collected the package, from where, and when.

### Two-Device Sync

Risk: one phone/browser shows a package update while another signed-in device for the same user stays stale.

Current logic:

- The app supports the same approved user on more than one device at the same time.
- There is no SMS/device verification in this pilot.
- If an approved user enters the same approved phone number on a new device, that new anonymous Firebase session is recognized as approved.
- Firestore data is refreshed by polling every 5 seconds, not by instant realtime listeners.
- Therefore, a second device should normally show changes within 5 seconds, and anything still stale after 10 seconds is a blocker.

Functional test:

1. Open the production URL on Device A and Device B.
2. Sign in on both devices with the same approved regular user.
3. On Device A, add a package to `פיצוץ להבים`.
4. Device B should show the new package on Home within 5 seconds.
5. Device B should show the correct `ממתינות לאיסוף` count and pickup-location count.
6. On Device B, collect that package.
7. Device A should show the package as `נאספה` within 5 seconds.
8. Device A should show the collector name and the top status counter should move from `ממתינות לאיסוף` to `נאספו`.
9. On Device B, update delivery in `מסירה`.
10. Device A should show the package as `הגיעה לקיבוץ` within 5 seconds.
11. On Device A, press `אשר קבלה`.
12. Device B should show the package as `נמסרה` and the `התקבלה` state within 5 seconds.

Failure conditions:

- Either device is kicked back to the join screen while the other remains active.
- One device updates and the other remains stale for more than 10 seconds.
- Home top counters and `סטטוס חבילה` disagree on either device.
- A package appears on one device but disappears from the other.
- The same approved user creates duplicate manager/member records by using two devices.

### Pickup Locations

Risk: admin-created locations do not participate in the full app flow.

Expected:

- Admin can add a pickup location with name, address, and opening hours.
- The new location appears on home.
- The new location appears in add-package.
- The new location appears in pickup.
- Opening-hours popup works for the new location.
- Open/closed visual state is shown using the configured hours.

## Firebase Rules Coverage

The rules test suite should verify:

- Pending users cannot create packages.
- Pending users cannot create pickup runs.
- Approved users can create their own packages.
- Sensitive delivery messages are hidden before pickup access is granted.
- Collectors can read sensitive delivery messages only after pickup access is granted.
- Admin can approve or reject pending users.
- Admin cannot promote users.
- Admin cannot block managers.
- Oz owner can promote users.
- Oz owner can block managers, excluding himself.
- Admin can create or update pickup locations.
- Blocked users cannot access active app data.

## Browser Regression Coverage

Playwright should fail the release if any of these appear:

- React hydration warning.
- `Maximum update depth exceeded`.
- Hebrew modal, toast, or form rendered left-to-right.
- Pending user can reach active app actions.
- Whole home screen scrolls when only the intended status area should scroll.
- Opening-hours icon overlaps pickup-location text.
- Pickup carousel arrow hides location content.
- Join, pending, add-package, or admin fields overlap.
- Warm open/closed colors are missing from pickup locations.
- Regular user bottom navigation has the wrong number of buttons.
- Admin bottom navigation does not show `ניהול`.

## Release Checklist

Before sharing with the community:

- Confirm the public URL opens the app, not the development explanation page.
- Confirm Oz can enter as owner using `עוז כרמל` and `0584411883`.
- Confirm one fresh user can join, be approved, and add a package.
- Confirm the test package is deleted or cleaned from production data.
- Confirm no duplicate Oz/admin records were created.
- Confirm the GitHub repo contains the latest release commit.
- Confirm Firebase Hosting or GitHub Pages has the latest build.

## Known Blockers To Watch

- Firestore rules tests must run successfully with a free emulator port.
- Production polling should keep admin lists and approval state updated within a few seconds.
- Duplicate users with the same phone number must be prevented.
- Any Firebase permission error during approval is a release blocker.
- Any path that lets a pending or blocked user add, collect, or receive packages is a release blocker.

## Pilot Acceptance

The app is ready for a limited Lahav pilot when:

- Critical release gate passes.
- Production smoke flow passes.
- Oz can approve users from the public URL.
- An approved user can add a real package.
- No pending user can perform active package actions.
- No sensitive delivery message is exposed before pickup confirmation.
