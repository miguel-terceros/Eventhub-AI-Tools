# EventHub — Booking Management Test Strategy

Generated: 2026-11-10
Input: `docs/test-scenarios.md` (86 scenarios, TC-001 – TC-512)
Consumer: `/generate-tests`

---

## 1. Distribution

| Layer | Scenarios (primary) | Est. test cases | Focus | Est. run time |
|---|---|---|---|---|
| **Unit** | 13 | ~40 | Booking-ref generation, `validateCreateBooking` rules, refund rule, price formatting | < 5 s |
| **API / Integration** | 41 | ~55 | Business rules that need DB state: seats, FIFO, ownership, cascade, error contracts | ~1–2 min (remote) |
| **Component (mocked UI)** | 22 | ~25 | Single-page rendering & UI states with `page.route` fully mocking the API | ~1 min |
| **E2E** | 10 (in 7 journey tests) | 7 | Critical multi-page, full-stack journeys only | ~2–3 min (remote) |
| **Total** | **86** | **~127** | | **~5 min** |

Shape: the base is unit (~40 cases), the middle is wide (API, ~55), and the top is narrow (7 E2E tests). The API layer has the most *scenarios* because most booking rules are database-state rules (FIFO, per-user seats, ownership), as explained in §4-R1. By *test case* count, unit and API dominate and E2E is about 5%.

The `tests/` folder is currently empty, so there's **zero automated coverage** of booking management. See §6.

---

## 2. Infrastructure & Conventions (for `/generate-tests`)

Only `@playwright/test` is installed. No Jest, Vitest, React Testing Library, or Playwright CT exists. Decision: **use the Playwright runner for every layer**, split into config projects, rather than adding new frameworks.

| Layer | Folder | Fixture | Target |
|---|---|---|---|
| Unit | `tests/unit/` | none (no `page`) — import backend/frontend modules directly | Local source (needs `npm run setup`) |
| API | `tests/api/` | `request` | `API_URL` env, default `https://api.eventhub.rahulshettyacademy.com/api` (verified: `/api/health` → `{"status":"ok"}`; unauthenticated `/api/bookings/*` → 401 `"Unauthorized"`) |
| Component | `tests/ui/` | `page` + `page.route('**/api/**')` (all calls mocked) + `page.addInitScript` to set `localStorage.eventhub_token` | `baseURL` (deployed frontend) |
| E2E | `tests/e2e/` | `page` + `request` for setup/teardown | `baseURL` + `API_URL` |

**Required config change** (`playwright.config.ts`): add `projects` `unit`, `api`, `ui`, `e2e` with matching `testDir`s (chromium device only for `ui`/`e2e`). Keep `fullyParallel: false`. The shared test accounts make parallel runs unsafe.

**Shared helpers** (`tests/helpers/api.js`):
- `apiLogin(request, email)` → token via `POST /auth/login`
- `apiClearBookings(request, token)` → `DELETE /bookings`
- `apiCreateBooking(request, token, { eventId, quantity })` → booking
- `apiGetEvent(request, token, id)` → event (for seat reads)
- `uiLoginWithToken(page, token)` → `addInitScript(t => localStorage.setItem('eventhub_token', t), token)`

**Data rules**
- Every API/E2E test starts with `apiClearBookings` for each account it uses.
- Tests that need small seat counts or custom titles create their **own** event via `POST /events` and delete it in `afterEach`. This only affects the test user's own sandbox, so it's safe on the remote site.
- **Never** run TC-408 against the remote site, because it permanently mutates a shared static event. Tag it `@local` and `test.skip(!process.env.API_URL?.includes('localhost'))`.
- Defect scenarios (⚠️) assert the **intended** behavior and are wrapped in `test.fail()` with a comment linking the D-number. The suite stays green, and each one flips to passing when the bug is fixed.

### Testability refactors (prerequisites for part of the Unit layer)
| Refactor | Why | Unblocks |
|---|---|---|
| Move `randomRef` / `generateUniqueRef` from `bookingService.js` to exported `backend/src/utils/bookingRef.js` (inject `findByRef`) | Currently private; `generateUniqueRef` does I/O via `bookingRepository.findByRef` | TC-100, 101, 406, 407 unit |
| Extract `getRefundEligibility(quantity)` from `RefundEligibility` in `frontend/app/bookings/[id]/page.tsx` to `frontend/lib/utils/refund.ts` | Logic is inline in JSX | TC-112, 113, 404 unit |
| Extract `fmt_price` (duplicated in `BookingCard.jsx`, `bookings/[id]/page.tsx`, `admin/bookings/page.tsx`, `events/[id]/page.tsx`) to `frontend/lib/utils/format.ts` | Duplicated 4×; pure | TC-412 unit |

**`bookingValidator.js` needs no refactor.** `validateCreateBooking` is already exported. Run each chain with `await chain.run(req)` on a plain `{ body }` object, then read `validationResult(req)`. This is pure, with no I/O. If the refactors are not approved, `/generate-tests` should produce the validator unit tests now and leave the others at their API/Component secondary layer.

---

## 3. Layer Assignments

Legend: **bold** = primary layer; others = defense-in-depth.

### 3.1 Unit — `tests/unit/`

| TC | Scenario | Target under test | Also at |
|---|---|---|---|
| TC-100 | Ref prefix = title[0] uppercased; format `X-XXXXXX` | `randomRef()` *(refactor)* | API, E2E |
| TC-101 | Lowercase title → uppercase prefix | `randomRef('zumba night')` | API |
| TC-406 | 10 collisions → `<prefix>-<8 base36>` fallback | `generateUniqueRef()` with stub `findByRef` always truthy | — |
| TC-407 | Titles `2026 Expo`, `#Hackathon`, `🎉 Party`; null title → `E-` | `randomRef()` | API (one) |
| TC-305 | Name/email/phone/eventId invalid values (6 rows) | `validateCreateBooking` | API (1 representative) |
| TC-306 | Quantity 0, -1, 11, 2.5, "abc" rejected; 1 and 10 accepted | `validateCreateBooking` | API, Component (stepper) |
| TC-409 | `John.Doe+test@Gmail.com` → `johndoe@gmail.com` | `validateCreateBooking` (`normalizeEmail`) | — |
| TC-410 ⚠️ | `----------` accepted as phone (D8) | `validateCreateBooking` | API |
| TC-411 | Name/phone trimmed | `validateCreateBooking` | — |
| TC-112 | qty 1 → eligible | `getRefundEligibility` *(refactor)* | Component, E2E |
| TC-113 | qty 3 → not eligible, message contains count | `getRefundEligibility` | Component |
| TC-404 | qty 2 boundary → not eligible | `getRefundEligibility` | Component |
| TC-412 | 99.5 → "$100", 0 → "$0", 147 → "$147" | `formatPrice` *(refactor)* | Component |

### 3.2 API / Integration — `tests/api/`

Endpoints: `bookingRoutes.js` → `bookingController` → `bookingService` (`getBookings`, `getBookingById`, `getBookingByRef`, `createBooking`, `clearAllBookings`, `cancelBooking`).

**`booking-crud.api.spec.js`**
| TC | Endpoint / function | Assertion focus |
|---|---|---|
| TC-009 | `POST /bookings` → `createBooking`; `GET /bookings/:id`, `/bookings/ref/:ref` | 201, `message: "Booking confirmed!"`, envelope, same booking from both GETs |
| TC-010 | `DELETE /bookings` → `clearAllBookings` | `"N booking(s) cleared"`, total 0 |
| TC-011 | `DELETE /bookings/:id` → `cancelBooking` | 200 `"Booking cancelled"`, then GET 404 |
| TC-012 | `GET /bookings?eventId=` → `bookingRepository.findAll` | filter |
| TC-114 | `POST` with `status:"cancelled"` | status forced to "confirmed" |
| TC-115 | `GET /bookings` | `createdAt desc` ordering |
| TC-416 | `GET /bookings?status=cancelled` | empty (hard delete, D4) |
| TC-415 | `DELETE /bookings` with 0 bookings | `"0 booking(s) cleared"` |

**`booking-rules.api.spec.js`**
| TC | Function | Assertion focus |
|---|---|---|
| TC-100 | `generateUniqueRef` via `createBooking` | Prefix check across all 10 static events (loop) |
| TC-101 / TC-407 | same | Own event "zumba night" → `Z-`, "2026 Expo" → `2-` |
| TC-102 | `createBooking` `totalPrice = price × quantity` | 49 × 3 = 147 |
| TC-413 | same | price 0 → 0 |
| TC-103 / TC-104 | `eventService.withPersonalSeats` + `getBookedQuantitiesForEvents` | S → S−2 → S |
| TC-105 | `clearAllBookings` | Seats restored on 2 events |
| TC-106 | `withPersonalSeats` per userId | Gmail vs Yahoo isolation |
| TC-405 | `createBooking` same event twice | Distinct refs, seats −3 |
| TC-400 | `countUserBookings` | 9 bookings, none pruned |
| TC-401 | validator + service | qty 1 and 10 → 201 |
| TC-403 | `createBooking` seat check | Book to 0 → `availableSeats 0`; next → 400 |
| TC-110 | Prisma cascade | Delete own event → booking 404 |
| TC-111 | `eventService.createEvent` FIFO + cascade | 7th event prunes booking of oldest event |

**`booking-fifo.api.spec.js`** (each test self-seeds; no cross-test state)
| TC | Function | Assertion focus |
|---|---|---|
| TC-107 | `findOldestUserBookingExcludingEvent` | 10th prunes oldest (different event) |
| TC-108 | same | Prefers oldest *different-event* booking over older same-event |
| TC-109 | `findOldestUserBooking` + `eventRepository.decrementSeats` | Same-event fallback burns seat (own event) |
| TC-309 ⚠️ | prune-before-validate (D2) | `test.fail()` — failed 10th booking must keep 9 |
| TC-408 ⚠️ | decrement on static event (D3) | `@local` only, `test.fail()` |

**`booking-security.api.spec.js`**
| TC | Function | Assertion focus |
|---|---|---|
| TC-201 | `getBookingById` → `ForbiddenError` | 403 + no data leaked |
| TC-202 | `getBookingByRef` → `ForbiddenError` | 403 |
| TC-203 ⚠️ | `cancelBooking` uses `findById(id, userId)` → 404 (D1) | Mandatory: owner's booking survives. Status: assert 404 (current) and annotate D1 |
| TC-204 | `deleteAllForUser(userId)` | Other user's bookings intact |
| TC-205 | `findAll` `where: { userId }` | All returned `userId` = caller |
| TC-206 | `eventRepository.findById(eventId, userId)` | 404 on other user's event |
| TC-207 | `authMiddleware` | 6 endpoints × no header → 401 `"Unauthorized"` (parameterized) |
| TC-208 | `authMiddleware` `jwt.verify` | 401 `"Invalid or expired token"` |
| TC-210 | controller uses `req.user.userId` | body `userId` ignored |

**`booking-validation.api.spec.js`** (contract smoke only; exhaustive rules live in unit)
| TC | Assertion focus |
|---|---|
| TC-304 | `{}` → 400 `"Validation failed"` + `details` for 5 fields |
| TC-305 / TC-306 | One representative invalid value each → 400 (proves the validator is wired to the route) |
| TC-307 | Unknown eventId → 404 |
| TC-308 | Insufficient seats → 400 `"Only 1 seat(s) available, but 2 requested"` |
| TC-301 | Unknown id / ref → 404 messages |
| TC-302 | Double cancel → 404 |
| TC-310 ⚠️ | `/bookings/abc` → expect 4xx; `test.fail()` if 500 (D6) |
| TC-311 ⚠️ | `page=0`, `limit=-5` → expect non-500 (D14); `page=abc` → defaults |
| TC-410 ⚠️ | `----------` phone → expect 400 (D8), `test.fail()` |

### 3.3 Component (mocked UI) — `tests/ui/`

All tests here mock **every** `/api/**` call with `page.route` and inject a fake token, so there's no backend state and no flakiness from shared data. Use mock fixtures `BOOKING_QTY_1`, `BOOKING_QTY_3`, `BOOKINGS_LIST_9`, `EMPTY_LIST`.

| TC | Component / file | Mock | Assertion focus |
|---|---|---|---|
| TC-112 / TC-113 / TC-404 | `RefundEligibility` (`bookings/[id]/page.tsx`) | GET booking qty 1 / 3 / 2 | Exact result text (D12) |
| TC-503 | `RefundEligibility` | qty 1 | Use `page.clock.install()` + `runFor(4000)`: spinner text, then result; no real 4 s wait |
| TC-504 | `RefundEligibility` | qty 1 | Button hidden after result; back after reload |
| TC-505 | `ConfirmDialog` in `BookingCard.jsx` & detail page | booking R, qty N | Both description variants |
| TC-506 | `ConfirmDialog` | — | Close/Escape → `DELETE` never requested (`page.on('request')`) |
| TC-313 | `BookingCard.handleCancel` | `DELETE` → 500 | Error toast, card stays |
| TC-414 | detail `handleCancel` | `DELETE` → 404 | Toast `"Booking with id X not found"` |
| TC-314 ⚠️ | `BookingsContent.handleClearAll` | `DELETE /bookings` → 500 | Button resets; document missing toast (D5) |
| TC-315 | `handleClearAll` + `window.confirm` | — | `dialog.dismiss()` → no `DELETE` |
| TC-507 | `handleClearAll` | delayed `DELETE` | "Clearing…" + disabled |
| TC-500 | `bookings/page.tsx` empty state | `EMPTY_LIST` | "No bookings yet", "Browse Events" → `/events` |
| TC-501 | `BookingCardSkeleton` | delayed GET | 5 skeletons, then cards |
| TC-502 | error `EmptyState` | GET → 500, then 200 | "Couldn't load bookings", Retry works |
| TC-508 | `BookingCard.jsx` | qty 1 & 3 | "1 ticket" / "3 tickets" |
| TC-509 | `Pagination` | 9 bookings, `totalPages: 1` | 9 cards, no next page |
| TC-510 | `bookings/page.tsx` | 9 bookings | No `/sandbox holds up to/i` (D13) |
| TC-512 | detail page spinner | delayed GET | Spinner, then content |
| TC-300 / TC-303 | detail error state | GET → 404 | "Booking not found" (merged into one test) |
| TC-008 | detail page nav | booking | Back button + breadcrumb → `/bookings` |
| TC-211 | detail page + `BookingCard` | `customerName: '<img src=x onerror=alert(1)>'` | Literal text; `page.on('dialog')` never fires |
| TC-312 | `BookingForm.validate()` (`events/[id]/page.tsx`) | GET event | 3 inline errors; `POST /bookings` never requested |
| TC-402 | quantity stepper | event `availableSeats` 50 / 3 | Max 10 / max 3; "-" disabled at 1 |

Also at Component (secondary): TC-403 Sold Out rendering (event `availableSeats: 0` → card "Sold Out", button disabled), TC-412 price display, TC-200 "Access Denied" render (GET → 403).

### 3.4 E2E — `tests/e2e/booking-journeys.spec.js`

Real frontend and backend; setup and teardown through `request` helpers; login via the UI in only **one** journey (J1). The others inject the token.

| Journey | Covers TCs | Flow | Why E2E |
|---|---|---|---|
| J1 Book → view → detail | **TC-001, TC-007, TC-002, TC-003**; asserts TC-100 at UI | UI login → `/events` → Book Now → confirm → ref regex + prefix → View My Bookings → card → View Details → sections | The revenue-critical journey spans 4 pages and the full stack |
| J2 Cancel from detail | **TC-004** | API seed → detail → Cancel → dialog → toast → redirect → gone | Mutation + navigation + toast across pages |
| J3 Cancel from list | **TC-005** | API seed 2 → list → cancel one → stays on list, 1 remains | Different post-cancel navigation (D15) |
| J4 Clear all | **TC-006** | API seed 2 → `dialog.accept()` → empty state; verify `GET /bookings` total 0 | Native dialog + backend effect |
| J5 Cross-user denied | **TC-200** | Gmail seeds via API → Yahoo token injected → `/bookings/:id` → "Access Denied" | Critical security rule; real 403 through real interceptor |
| J6 Unauthenticated redirect | **TC-209** | No token → `/bookings` and `/bookings/1` → `/login` | Real 401 → interceptor → redirect |
| J7 Seats & cache | **TC-511**, smoke TC-112 | Read seats → book qty 1 via UI → `/bookings` (no reload) → cancel → `/events` seats restored → refund check on a qty-1 booking | Verifies React Query invalidation against a real backend |

### 3.5 Defense-in-depth matrix (critical rules)

| Rule | Unit | API | Component | E2E |
|---|---|---|---|---|
| Ref prefix = title[0] upper | TC-100/101/407 | TC-100 (10 events) | — | J1 |
| Quantity 1–10 | TC-306 | TC-306/401 | TC-402 | — |
| Refund eligibility | TC-112/113/404 | — (client-only) | TC-112/113/404/503 | J7 smoke |
| Seats reduce/restore, per user | — | TC-103/104/105/106 | TC-403 | J7 |
| Max 9 bookings FIFO | — | TC-107/108/109/309/400 | TC-509 | — |
| Cross-user isolation | — | TC-201–206 | TC-200 render | J5 |
| Cancel / Clear all | — | TC-010/011/302 | TC-313/314/315/506 | J2, J3, J4 |

---

## 4. Decision Rationale (contested assignments)

**R1 — FIFO (TC-107/108/109/309) at API, not Unit.** `createBooking` interleaves 4 repository calls (`countUserBookings`, `findOldestUserBookingExcludingEvent`, `findOldestUserBooking`, `delete`) with seat checks. A unit test would need Prisma mocks that just restate the implementation, and could never have caught D2 (prune-before-validate ordering is only visible as real side effects). API tests are deterministic here because each user's data is isolated and every test clears its bookings first.

**R2 — Per-user seats (TC-103–106) at API, not E2E.** `withPersonalSeats` is fully observable in the `availableSeats` field of `GET /events/:id`. E2E adds only rendering, and that is covered once in J7.

**R3 — Validation (TC-305/306/409/410/411) at Unit + API smoke, not E2E.** `validateCreateBooking` is a pure express-validator chain and can be run in-process. The API layer keeps one case per field to prove the chain is wired to `POST /bookings`. The UI validation (TC-312) is a *separate* implementation (`validate()` in `events/[id]/page.tsx`, which has different phone logic, see D8), so it's tested on its own at Component.

**R4 — Refund eligibility at Unit + Component + one E2E smoke.** It is client-only logic (`quantity === 1`), with no backend involvement. A real E2E would need a real booking plus a 4 s wait. Component tests with a mocked booking and `page.clock` cover every branch fast. One E2E smoke stays because it is a headline domain rule.

**R5 — Error UI states (TC-300/303/313/314/414/502) at Component, not E2E.** Forcing a real 500 or race condition against the shared remote site is impossible or flaky. `page.route` gives exact, repeatable status codes. The API layer separately proves the backend returns those codes (TC-301/302).

**R6 — TC-200 at E2E *and* TC-201 at API.** The 403 contract is an API concern. However, the "Access Denied" UI depends on the Axios interceptor in `lib/api/client.js` copying `status` onto the error, and on `bookings/[id]/page.tsx` checking `error.status === 403`. That chain is only verified end-to-end once (J5); everything else stays at API.

**R7 — TC-209 (unauthenticated redirect) at E2E.** The redirect is done by the response interceptor (`window.location.href = '/login'`) reacting to a real 401. It's cheap (no data setup), and mocking it would only test the mock.

**R8 — TC-211 (XSS) at Component.** The question is whether React escapes output. That needs no backend, and a mocked payload avoids storing malicious data in the shared remote database.

**R9 — TC-408 at API, local only.** It is the only scenario that changes data visible to other users on a shared environment.

**R10 — TC-002/003 (card and detail fields) folded into E2E J1 rather than separate Component tests.** They are natural checkpoints of the critical journey, so a separate mocked test would duplicate coverage with little benefit. If J1 becomes too slow, move the field checks to Component.

**R11 — Clear all (TC-006) at E2E even though `DELETE /bookings` is covered at API.** The UI goes through native `window.confirm` and a *different* API module (`lib/api/bookings.ts`, not `bookingsApi.js`). There are two API client files (`client.js` with Axios + JWT, `client.ts` with fetch and **no** auth header), so whether this path sends the token depends on bundler resolution. Only a real E2E run proves the button actually clears data.

---

## 5. Out of Scope / Not Assigned
- **Admin bookings page** (`admin/bookings/page.tsx`): only TC-416 touches it, and that's verified at API. Add Component tests if admin flows enter scope.
- **Performance and concurrency** beyond TC-414.

---

## 6. Existing Tests & Anti-Patterns

**Current state: `tests/` is empty.** There are no booking tests at any layer. That is the "no E2E tests for critical flows" anti-pattern in its most extreme form. **Priority for `/generate-tests`:** E2E J1 (book → view → detail) and the API security/FIFO files first, because those cover all P0 scenarios.

The previous `tests/booking-management.spec.js` (6 E2E tests, now deleted) had problems that new tests must **not** repeat. Treat these as guardrails:

| # | Anti-pattern seen previously | Guardrail for generated tests |
|---|---|---|
| A1 | **Ice-cream cone**: 6/6 tests were E2E; 0 API, 0 unit | Follow the §1 distribution; E2E is limited to J1–J7 |
| A2 | **Pure logic at E2E**: ref-prefix rule tested only through the UI | Ref rule at Unit + API (TC-100); one assertion in J1 |
| A3 | **UI-driven setup**: every test logged in through the form and booked through the UI before the real check | `apiLogin` + `apiCreateBooking` + token injection; UI login only in J1 |
| A4 | **Racy cleanup**: `isVisible()` doesn't wait, so it read the skeleton state and only worked by accident | Clean up with `apiClearBookings(request, token)`, never through the UI |
| A5 | **Duplicated flow**: booking steps copied inline instead of reusing the helper | All shared steps live in `tests/helpers/` |
| A6 | **Stale TC IDs** in test titles | Titles must use current IDs from `docs/test-scenarios.md` (e.g. `TC-100: …`) |
| A7 | **Hard-coded `BASE_URL`** duplicating the config. The `playwright-best-practices` skill says `http://localhost:3000`, but the config uses the remote URL. | Use relative `page.goto('/bookings')` with config `baseURL`; read `API_URL` from env. Fix the skill doc. |
| A8 | **Last-resort CSS locators** (`span.font-mono.font-bold`, `.confirm-booking-btn`, `.booking-ref`) | Prefer `getByTestId` / `getByRole('button', { name: 'Confirm Booking' })`; ask devs for `data-testid="booking-ref"` on the detail header and confirmation card |
| A9 | **Weak assertion**: after a cancel, it checked "No bookings yet", which doesn't prove *that* booking was removed | Assert the `booking-card` filtered by `bookingRef` has count 0, plus API `GET /bookings/:id` → 404 |
| A10 | **Shared mutable account on a shared site**: "Clear all" on `rahulshetty1@gmail.com` wipes anyone else's data on the same account | Prefer a per-run registered user (`POST /auth/register` with `test+${Date.now()}@…`) for API/E2E; keep fixed accounts for cross-user J5 only |
