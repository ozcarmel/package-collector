# Lahav Packages - Compact Codex Context

Use this document as the short working context for future Codex/API sessions.

## Communication Rule

Always answer the user in English, even if the user writes Hebrew.

## Product

App name: Hebrew title meaning "Lahav Packages". In the UI it is written as "Havilot Lahav" in Hebrew letters.

Goal: replace the Kibbutz Lahav WhatsApp package thread with a focused PWA / future Android app where verified members can:

- Add a package waiting at a pickup point.
- See how many packages wait at each pickup point.
- Confirm they are physically at a pickup point before seeing sensitive pickup details.
- Collect packages for others.
- Mark packages as collected.
- Later update where the collected packages were left inside the kibbutz.
- Let admins approve members and grant admin permissions.

## Core Privacy Model

Delivery company messages are sensitive because they often include pickup links, codes, names, and tracking numbers.

Public package documents must not expose the original delivery message.

Sensitive details are revealed only after:

1. User is signed in and approved.
2. User selects a pickup location with waiting packages.
3. User confirms: "I am already at the pickup point. This action will be logged."
4. Backend creates a pickup run and returns sensitive details only for that run/location.

All sensitive access should be logged.

## Pickup Locations

Current structured pickup locations:

- Home Paami Lehavim
- Doar Lehavim
- Pitzutz Lehavim
- Eshkolot
- Deli Place Lehavim
- Shoval

Important correction: there is only one Home Paami, at Sderot Seora 1, Lehavim. Do not add another "Hop Paami"; that was a typo.
Eshkolot pickup point: Mazkirut Eshkolot.
Eshkolot opening hours: Sunday-Thursday 08:00-13:00.
Pitzutz Lehavim opening hours: Sunday-Thursday 10:00-14:00 and 18:00-21:00.
Shoval pickup point: Doar Shoval.

## UX Decisions

- Entire app is RTL.
- UI language is Hebrew, but Codex responses are always English.
- Title: Hebrew "Havilot Lahav".
- Bottom nav: home, add, pickup, admin.
- Admin tab should be visible only to admin/owner users in production.
- Home screen should not scroll as one whole page; lower package/status area may scroll.
- Avoid bright white backgrounds. Use warm beige/off-white surfaces.
- Avoid the disliked decorative display font. Use a clean readable Hebrew-friendly font.
- Pickup location carousel should support RTL behavior and arrow direction should flip at scroll end.
- In pickup flow, clicking a location with `0` waiting packages must not open the confirmation popup.
- Popup text/button layout must be RTL.
- In catalog, collected action should be a small clear checkbox/button labeled with the Hebrew word for "collected", not a misleading pre-checked button.
- Original delivery message links must be clickable after secure reveal.
- Home pickup-location boxes use color only to indicate opening state: soft green for open, muted warm-red for closed/unavailable. Do not add a status pill unless explicitly requested.
- The old aggregate "all pickup points" home card was removed.
- Each real pickup location on the home page has a small opening-hours icon in the visual top-left corner of the box. That icon opens a read-only opening-hours sheet. The location box itself remains for package filtering/pickup flow.

## Architecture

Frontend:

- Next.js app.
- Main component: `src/components/lahav-packages-app.tsx`.
- The page uses `src/app/client-home.tsx` with a `useSyncExternalStore` mounted gate so server render and first client render are both empty, then the app mounts client-side. This avoids app-shell hydration mismatch warnings without a Next client-rendering bailout.
- Demo/local state still supported.
- Firestore-backed repository path exists for production.

Backend:

- Firebase Firestore.
- Firebase Auth bootstrap currently anonymous/session-based, pending real phone auth.
- Firebase Cloud Functions for sensitive operations.

Important files:

- `src/components/lahav-packages-app.tsx`
- `src/lib/types.ts`
- `src/lib/demo-data.ts`
- `src/lib/app-state-actions.ts`
- `src/lib/app-state-repository.ts`
- `src/lib/app-repository-contract.ts`
- `src/lib/app-repository.ts`
- `src/lib/firebase/client.ts`
- `src/lib/firebase/firestore-repository.ts`
- `src/lib/firebase/auth-bootstrap.ts`
- `src/lib/firebase/app-state-subscriptions.ts`
- `src/lib/firebase/sensitive-package-functions.ts`
- `functions/src/index.ts`
- `firestore.rules`
- `firestore.indexes.json`
- `firebase.json`
- `product_plan.md`
- `src/lib/__tests__/app-state-actions.test.ts`

## Current Implementation Map

1. DONE - Define repository contracts
2. DONE - Keep local demo repository
3. DONE - Add Firestore repository skeleton
4. DONE - Add repository selector
5. PARTLY DONE - Refactor UI handlers toward repository actions
6. DONE - submitJoinRequest wired to configured repository
7. DONE - Admin approval/rejection/promotion wired to configured repository
8. DONE - Firebase auth / verified user bootstrap
9. DONE - Firestore live app-state subscriptions added
10. DONE - Sensitive delivery message boundary added
11. DONE - Package creation wired to configured repository
12. DONE - Pickup run / access logging / collected flow wired
13. DONE - Tests for repository-backed flows added
14. PARTLY DONE - Production hardening

Latest completed hardening:

- Package creation moved to callable `createPackageWithSensitiveDetails`.
- Sensitive messages stored in `sensitivePackageDetails`.
- Direct client reads/writes to `sensitivePackageDetails` are blocked.
- Pickup-run creation moved to callable `startSecurePickupRun`.
- Backend creates pickup run, pickup-run items, initial access logs, and returns revealed sensitive details.
- "Collected" action moved to callable `markPackageCollectedSecurely`.
- Backend validates collector/run/package before marking collected.
- Direct client creation of `packages`, `pickupRuns`, and `pickupRunItems` is blocked.
- Direct client collection updates are blocked.
- Client stores revealed sensitive details only in local state after secure callable returns.
- Pickup-location seed tooling added under `functions/scripts/seed-pickup-locations.mjs`.
- Seed command: `npm --prefix functions run seed:pickup-locations -- --project YOUR_FIREBASE_PROJECT_ID`.
- Dry run command: `npm --prefix functions run seed:pickup-locations -- --dry-run`.
- Open/closed color state for home pickup-location boxes is implemented in `src/lib/pickup-location-hours.ts` and `src/app/globals.css`.
- Temporary demo open-state override: locations without real `weeklyHours` render open for demo purposes. Eshkolot now has real weekly hours and is calculated from its schedule.
- Home-page opening-hours icon and read-only sheet are implemented in `src/components/lahav-packages-app.tsx`.

## Cloud Functions

Implemented in `functions/src/index.ts`:

- `createPackageWithSensitiveDetails`
- `startSecurePickupRun`
- `revealSensitiveDetailsForPickupRun`
- `markPackageCollectedSecurely`

Functions verify signed-in approved user before sensitive operations.

## Firestore Rules

Important rule intent:

- Users can read own user doc; admins can read users.
- Users cannot approve themselves or grant themselves roles.
- Join requests are readable by owner/admin.
- Approved users can read public package/location data.
- Direct package creation is blocked.
- Direct pickup run/item creation is blocked.
- Sensitive package details are unreadable/unwritable from client.
- Package collection is backend-controlled.
- Arrival update is currently still client-side with narrow rules.

## Current Verification Commands

Run after meaningful changes:

```bash
npm test
npm run lint
npm run typecheck
npm --prefix functions run build
npm --prefix functions run seed:pickup-locations -- --dry-run
npm run build
curl.exe -I --max-time 8 http://127.0.0.1:3002/
```

Latest known status: all passed; localhost returned `200 OK`.

Demo URL:

`http://127.0.0.1:3002/`

The user wants this localhost link shown at the end of every completed work response.

## Remaining Work

Step 14 remaining:

- Deploy and validate Firestore rules, indexes, functions, and hosting against a real Firebase project.
- Resolve or explicitly accept moderate dependency audit warnings in Functions package.
- Consider moving arrival/location update into backend callable too.
- Implement real phone authentication instead of only anonymous bootstrap.
- Add production admin bootstrap/owner seeding.
- Add notification system using the existing `lahav-package-status-notifications` skill if touching notifications.

## Testing Notes

Existing tests are in:

`src/lib/__tests__/app-state-actions.test.ts`

They cover local action flows, not full Firebase emulator rules/functions yet.

Need future tests:

- Firebase Functions unit/emulator tests.
- Firestore security rules tests.
- End-to-end pickup flow with secure reveal.

## User Preferences

- Be direct, practical, and concise.
- The user values visual accuracy and notices UI inconsistencies.
- When finishing work, show:
  - what changed
  - implementation map with last done highlighted
  - verification results
  - localhost link
- Never claim a browser/UI flow was verified unless actually tested.
- If a test is simulated/local only, say so clearly.
