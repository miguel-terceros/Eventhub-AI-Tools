# EventHub — Booking Management Test Scenarios

Generated: 2026-11-10
Scope: Booking Management — create booking (as entry point), view list, view detail, cancel, clear all, refund eligibility, FIFO pruning, per-user seats, cross-user access.

Sources: `eventhub-domain` skill (business-rules, user-flows, api-reference, ui-selectors), `backend/src/services/bookingService.js`, `backend/src/repositories/bookingRepository.js`, `backend/src/validators/bookingValidator.js`, `frontend/app/bookings/**`, `frontend/app/events/[id]/page.tsx`, `frontend/components/bookings/BookingCard.jsx`, `frontend/app/admin/bookings/page.tsx`.

---

## Discovered Behaviors & Domain-Doc Discrepancies

The code was treated as the source of truth. Scenarios below that assert these behaviors are tagged **[CODE]**; the ones marked ⚠️ are likely defects and should be confirmed with the product owner.

| # | Behavior in code | Domain skill says |
|---|---|---|
| D1 ⚠️ | Cross-user `DELETE /api/bookings/:id` returns **404** ("Booking with id X not found") because the lookup is scoped by `userId`. Cross-user `GET` returns **403**. | Cross-user access → 403 |
| D2 ⚠️ | FIFO pruning runs **before** the event-exists and seat checks. At 9 bookings, a 10th booking that fails (404 event / 400 seats) still deletes the oldest booking. | Pruning happens when a booking is added |
| D3 ⚠️ | Same-event FIFO fallback permanently decrements `Event.availableSeats` in the DB, **including static events**, which affects every user's view of that event. | Static events immutable; sandboxes isolated |
| D4 | Cancellation hard-deletes the booking. Status is always `confirmed`; the admin "Cancelled" status filter can never match anything. | Status always "confirmed" |
| D5 | "Clear all bookings" is always rendered (even with 0 bookings), uses native `window.confirm()`, and silently swallows API errors (no toast). | Clear-all link visible when bookings exist |
| D6 ⚠️ | Non-numeric booking id (`/api/bookings/abc`) → `Number('abc')` = NaN → Prisma error → likely **500**, not 400/404. | — |
| D7 | `customerEmail` passes through `normalizeEmail()`: lowercased, and Gmail dots and `+tags` removed (e.g. `John.Doe+x@Gmail.com` → `johndoe@gmail.com`). | Valid email format |
| D8 ⚠️ | API phone validator accepts 10+ chars of `[0-9+\-\s()]`, so `----------` is valid via API. The UI requires 10 digits. | Min 10 digits |
| D9 | Prices render with `maximumFractionDigits: 0`, so $99.50 × 1 displays as "$100". | — |
| D10 | Ref format is `<title[0] uppercased>-<6 chars A-Z0-9>`; the fallback after 10 collisions is `<prefix>-<8 base36 chars>`. A title starting with an emoji produces a broken surrogate prefix. | `[FIRST_LETTER]-[6_RANDOM]` |
| D11 | `/bookings` page size = 10 (admin page = 15). With max 9 bookings, the user list never paginates. | "Bookings page shows max 9" |
| D12 | Refund trigger text is "Check eligibility for refund?". Results: "**Eligible for refund.** Single-ticket bookings qualify for a full refund." / "**Not eligible for refund.** Group bookings (N tickets) are non-refundable." | "Check Refund Eligibility" button |
| D13 | No sandbox warning banner exists on `/bookings` (only on `/events`). | Conditional banner on bookings page |
| D14 ⚠️ | `page=0` or a negative `limit` produces a negative `skip`/`take` → likely 500. `limit` has no upper bound. | — |
| D15 | Cancelling from a list card keeps the user on `/bookings`. Cancelling from the detail page redirects to `/bookings`. Both show the toast "Booking cancelled successfully". | — |

---

## Happy Path

### TC-001: Book a static event and see confirmation with booking reference
**Category**: Happy Path
**Priority**: P0
**Preconditions**: Logged in as `rahulshetty1@gmail.com`; at least one non-sold-out static event
**Steps**:
1. Go to `/events`, click "Book Now" on the first available event card
2. Keep quantity 1, fill Full Name, Email, Phone (`+91 98765 43210`)
3. Click "Confirm Booking"
**Expected Results**: Confirmation card shows `.booking-ref` matching `/^[A-Z0-9]-[A-Z0-9]{6}$/`, ticket count 1, and a "View My Bookings" button
**Business Rule**: User journey; booking ref generated on booking
**Suggested Layer**: E2E

---

### TC-002: View bookings list
**Category**: Happy Path
**Priority**: P0
**Preconditions**: Logged in; user has ≥1 booking
**Steps**:
1. Click navbar "My Bookings" (`nav-bookings`)
**Expected Results**: URL is `/bookings`, heading "My Bookings" is visible, and each `booking-card` shows ref, "confirmed" badge, `#<id>`, event title, event date, ticket count ("1 ticket"/"N tickets"), city, booked date, total price, a "View Details" button and a "Cancel Booking" button
**Business Rule**: Flow 4 — Manage Bookings
**Suggested Layer**: E2E

---

### TC-003: View booking detail page
**Category**: Happy Path
**Priority**: P0
**Preconditions**: Logged in; user has ≥1 booking
**Steps**:
1. On `/bookings`, click "View Details" on a card
**Expected Results**: URL is `/bookings/:id`, `h1` = event title, the ref appears in the breadcrumb and header, and the page shows the Event Details section (event, category, date, venue, city), the Customer Details section (name, email, phone), the Payment Summary section (tickets, price per ticket, total paid), the Refund section, and Booking Information (booked on, `#id`)
**Business Rule**: Flow 4; Booking model fields
**Suggested Layer**: E2E

---

### TC-004: Cancel a booking from the detail page
**Category**: Happy Path
**Priority**: P0
**Preconditions**: Logged in; user has a booking
**Steps**:
1. Open `/bookings/:id`, click "Cancel Booking"
2. In the dialog "Cancel this booking?", click "Yes, cancel it" (`confirm-dialog-yes`)
**Expected Results**: Toast "Booking cancelled successfully", redirect to `/bookings`, booking no longer listed; `GET /api/bookings/:id` → 404
**Business Rule**: User can cancel individual bookings
**Suggested Layer**: E2E

---

### TC-005: Cancel a booking from the bookings list card
**Category**: Happy Path
**Priority**: P0
**Preconditions**: Logged in; user has ≥2 bookings
**Steps**:
1. On `/bookings`, click `cancel-booking-btn` on one card
2. Click `confirm-dialog-yes`
**Expected Results**: Toast "Booking cancelled successfully"; user stays on `/bookings` [CODE D15]; card count decreases by 1; other bookings remain
**Business Rule**: User can cancel individual bookings
**Suggested Layer**: E2E

---

### TC-006: Clear all bookings
**Category**: Happy Path
**Priority**: P0
**Preconditions**: Logged in; user has ≥2 bookings
**Steps**:
1. On `/bookings`, register a `page.on('dialog', d => d.accept())` handler
2. Click "Clear all bookings"
**Expected Results**: Native confirm text is "Clear all your bookings? This cannot be undone."; the list switches to the empty state "No bookings yet"; `GET /api/bookings` returns `pagination.total = 0`
**Business Rule**: "Clear All Bookings" removes all bookings in one go
**Suggested Layer**: E2E

---

### TC-007: Navigate from confirmation to My Bookings
**Category**: Happy Path
**Priority**: P1
**Preconditions**: Logged in
**Steps**:
1. Complete a booking (TC-001)
2. Click "View My Bookings" on the confirmation card
**Expected Results**: `/bookings` shows the new booking as the first card (list ordered `createdAt desc`) with the same ref as the confirmation
**Business Rule**: After booking, user can view bookings via "View My Bookings"
**Suggested Layer**: E2E

---

### TC-008: Navigate back from detail to list
**Category**: Happy Path
**Priority**: P2
**Preconditions**: Logged in; on a booking detail page
**Steps**:
1. Click "← Back to My Bookings" (repeat using the "My Bookings" breadcrumb link)
**Expected Results**: Both navigate to `/bookings`
**Business Rule**: Flow 4 navigation
**Suggested Layer**: E2E

---

### TC-009: Create and fetch a booking via API
**Category**: Happy Path
**Priority**: P0
**Preconditions**: Valid JWT; known static event id
**Steps**:
1. `POST /api/bookings` with valid body, quantity 2
2. `GET /api/bookings/:id` and `GET /api/bookings/ref/:bookingRef`
**Expected Results**: POST → 201, `{ success: true, message: "Booking confirmed!", data: { status: "confirmed", quantity: 2, bookingRef, totalPrice, event } }`; both GETs → 200 with identical booking
**Business Rule**: API reference — Bookings
**Suggested Layer**: API

---

### TC-010: Clear all via API returns deleted count
**Category**: Happy Path
**Priority**: P1
**Preconditions**: Valid JWT; user has N bookings (N ≥ 1)
**Steps**:
1. `DELETE /api/bookings`
**Expected Results**: 200, `message` = "N booking(s) cleared"; subsequent list total = 0
**Business Rule**: Clear all user bookings
**Suggested Layer**: API

---

### TC-011: Cancel booking via API
**Category**: Happy Path
**Priority**: P1
**Preconditions**: Valid JWT; user owns booking id X
**Steps**:
1. `DELETE /api/bookings/X`
**Expected Results**: 200, `{ success: true, message: "Booking cancelled" }`; `GET /api/bookings/X` → 404
**Business Rule**: Cancel single booking
**Suggested Layer**: API

---

### TC-012: Filter bookings list by eventId via API
**Category**: Happy Path
**Priority**: P2
**Preconditions**: User has bookings for events A and B
**Steps**:
1. `GET /api/bookings?eventId=A`
**Expected Results**: Only bookings for event A are returned; `pagination.total` matches
**Business Rule**: API supports `?eventId` filter
**Suggested Layer**: API

---

## Business Rules

### TC-100: Booking ref first character matches event title first character
**Category**: Business Rule
**Priority**: P0
**Preconditions**: Logged in
**Steps**:
1. Book an event; capture event title (`h1` on event page) and `.booking-ref`
**Expected Results**: `bookingRef[0] === title[0].toUpperCase()`; ref matches `/^[A-Z0-9]-[A-Z0-9]{6}$/`
**Business Rule**: Booking ref first char = event title first char (uppercase)
**Suggested Layer**: E2E (one) + API (across all 10 static events)

---

### TC-101: Lowercase event title produces uppercase ref prefix
**Category**: Business Rule
**Priority**: P1
**Preconditions**: User creates an event titled "zumba night"
**Steps**:
1. Book the event via API
**Expected Results**: `bookingRef` starts with `Z-`
**Business Rule**: Ref prefix uppercased
**Suggested Layer**: API

---

### TC-102: Total price = event price × quantity
**Category**: Business Rule
**Priority**: P0
**Preconditions**: Static event with known price (e.g. Marathon Chennai, $49)
**Steps**:
1. Book with quantity 3
**Expected Results**: Form summary shows "$49 × 3 tickets" before submit; API `totalPrice` = 147; card total and detail "Total Paid" show "$147"
**Business Rule**: totalPrice = price × quantity
**Suggested Layer**: API (calc) + E2E (display)

---

### TC-103: Seat count reduces by booked quantity (per-user)
**Category**: Business Rule
**Priority**: P0
**Preconditions**: Logged in; note event's available seats S
**Steps**:
1. Book quantity 2 on the event
2. Reload event detail / `GET /api/events/:id`
**Expected Results**: Available seats = S − 2
**Business Rule**: Seat count reduces on booking (per-user computed)
**Suggested Layer**: API

---

### TC-104: Seat count restores on cancellation
**Category**: Business Rule
**Priority**: P0
**Preconditions**: Continue from TC-103
**Steps**:
1. Cancel the booking
2. `GET /api/events/:id`
**Expected Results**: Available seats back to S
**Business Rule**: Seat count restores on cancellation
**Suggested Layer**: API

---

### TC-105: Clear all restores seats for all affected events
**Category**: Business Rule
**Priority**: P1
**Preconditions**: Bookings on events A (qty 2) and B (qty 3); note seats SA, SB before booking
**Steps**:
1. `DELETE /api/bookings`
**Expected Results**: Event A seats = SA, Event B seats = SB
**Business Rule**: Seat restoration on deletion
**Suggested Layer**: API

---

### TC-106: Per-user seat isolation — User B's bookings don't affect User A's count
**Category**: Business Rule
**Priority**: P0
**Preconditions**: Gmail user (A) and Yahoo user (B); static event E
**Steps**:
1. A reads seats for E (= S)
2. B books 5 tickets on E
3. A reads seats for E again
**Expected Results**: A still sees S; B sees S − 5
**Business Rule**: User sandbox isolation; per-user seat availability
**Suggested Layer**: API

---

### TC-107: FIFO — 10th booking prunes oldest booking of a different event
**Category**: Business Rule
**Priority**: P0
**Preconditions**: Cleared bookings; user creates 9 bookings across events, oldest is on event A
**Steps**:
1. Create a 10th booking on event B (≠ A)
**Expected Results**: Total stays 9; oldest booking (event A) is gone; new booking present
**Business Rule**: Max 9 bookings, FIFO pruning
**Suggested Layer**: API

---

### TC-108: FIFO prefers a different event over the same event
**Category**: Business Rule
**Priority**: P1
**Preconditions**: 9 bookings: oldest is on event X, second oldest on event Y
**Steps**:
1. Create a 10th booking on event X
**Expected Results**: The oldest booking of event Y is pruned (not the older event-X booking); total = 9
**Business Rule**: FIFO prune excluding target event [CODE]
**Suggested Layer**: API

---

### TC-109: FIFO same-event fallback permanently burns seats
**Category**: Business Rule
**Priority**: P1
**Preconditions**: User-created event (to avoid touching shared data); 9 bookings all on that event (qty 1 each); note seats S
**Steps**:
1. Create 10th booking on the same event, qty 1
2. `GET /api/events/:id`
**Expected Results**: Total bookings = 9; available seats drop by 1 relative to before step 1, even though one booking was pruned (DB `availableSeats` decremented)
**Business Rule**: Same-event fallback burns a seat [CODE]
**Suggested Layer**: API

---

### TC-110: Deleting a user-created event cascades its bookings
**Category**: Business Rule
**Priority**: P1
**Preconditions**: User creates event E and books it
**Steps**:
1. `DELETE /api/events/E`
2. `GET /api/bookings`
**Expected Results**: Booking for E no longer exists; `GET /api/bookings/:id` → 404
**Business Rule**: Booking.eventId cascade delete
**Suggested Layer**: API

---

### TC-111: FIFO pruning of an event removes its bookings from the list
**Category**: Business Rule
**Priority**: P2
**Preconditions**: User has 6 created events; booking exists on the oldest one
**Steps**:
1. Create a 7th event
2. `GET /api/bookings`
**Expected Results**: Booking on the pruned event is gone
**Business Rule**: Max 6 events FIFO + cascade
**Suggested Layer**: API

---

### TC-112: Refund — single-ticket booking is eligible
**Category**: Business Rule
**Priority**: P0
**Preconditions**: Booking with quantity 1
**Steps**:
1. Open `/bookings/:id`, click `#check-refund-btn`
2. Wait for `#refund-result`
**Expected Results**: Result contains "Eligible for refund." and "Single-ticket bookings qualify for a full refund." (green style)
**Business Rule**: Refund — 1 ticket eligible
**Suggested Layer**: E2E (or Component)

---

### TC-113: Refund — multi-ticket booking is NOT eligible
**Category**: Business Rule
**Priority**: P0
**Preconditions**: Booking with quantity 3
**Steps**:
1. Open `/bookings/:id`, click `#check-refund-btn`
**Expected Results**: Result contains "Not eligible for refund." and "Group bookings (3 tickets) are non-refundable."
**Business Rule**: Refund — >1 ticket not eligible
**Suggested Layer**: E2E (or Component)

---

### TC-114: Booking status is always "confirmed"
**Category**: Business Rule
**Priority**: P2
**Preconditions**: Any booking
**Steps**:
1. Create via API with extra field `"status": "cancelled"`
**Expected Results**: Response `status` = "confirmed" (client field ignored)
**Business Rule**: Status always "confirmed"
**Suggested Layer**: API

---

### TC-115: Bookings list ordered newest first
**Category**: Business Rule
**Priority**: P2
**Preconditions**: Create bookings B1, then B2, then B3
**Steps**:
1. `GET /api/bookings`
**Expected Results**: Order is B3, B2, B1
**Business Rule**: List ordered by createdAt desc [CODE]
**Suggested Layer**: API

---

## Security

### TC-200: Cross-user booking detail shows "Access Denied" (UI)
**Category**: Security
**Priority**: P0
**Preconditions**: Gmail user owns booking X
**Steps**:
1. Log in as Yahoo user
2. Navigate to `/bookings/X`
**Expected Results**: Title "Access Denied", text "You are not authorized to view this booking.", "View My Bookings" button; no booking data rendered
**Business Rule**: Cross-user access → Access Denied
**Suggested Layer**: E2E

---

### TC-201: Cross-user GET by id returns 403
**Category**: Security
**Priority**: P0
**Preconditions**: User A owns booking X; token for user B
**Steps**:
1. `GET /api/bookings/X` with B's token
**Expected Results**: 403, `error` = "You are not authorized to view this booking"; no booking data in body
**Business Rule**: Cross-user access 403
**Suggested Layer**: API

---

### TC-202: Cross-user GET by ref returns 403
**Category**: Security
**Priority**: P0
**Preconditions**: User A owns ref R; token for user B
**Steps**:
1. `GET /api/bookings/ref/R` with B's token
**Expected Results**: 403, `error` = "You do not own this booking"
**Business Rule**: Cross-user access 403
**Suggested Layer**: API

---

### TC-203: Cross-user cancel cannot delete another user's booking ⚠️
**Category**: Security
**Priority**: P0
**Preconditions**: User A owns booking X; token for user B
**Steps**:
1. `DELETE /api/bookings/X` with B's token
2. `GET /api/bookings/X` with A's token
**Expected Results**: Step 1 is rejected — the code returns **404** "Booking with id X not found" [CODE D1], while the domain skill expects 403. Step 2 → 200, booking intact. The status code must be confirmed with the product owner; the data-integrity assertion is mandatory either way.
**Business Rule**: Cross-user access denied
**Suggested Layer**: API

---

### TC-204: Clear all only deletes the caller's bookings
**Category**: Security
**Priority**: P0
**Preconditions**: Users A and B each have bookings
**Steps**:
1. A calls `DELETE /api/bookings`
2. B calls `GET /api/bookings`
**Expected Results**: B's bookings unchanged
**Business Rule**: Sandbox isolation
**Suggested Layer**: API

---

### TC-205: Bookings list never leaks other users' bookings
**Category**: Security
**Priority**: P1
**Preconditions**: A and B both have bookings on the same static event
**Steps**:
1. B calls `GET /api/bookings?eventId=<event>` and `GET /api/bookings?limit=1000`
**Expected Results**: Every returned booking has `userId` = B
**Business Rule**: Each user sees only their own bookings
**Suggested Layer**: API

---

### TC-206: Cannot book another user's private (dynamic) event
**Category**: Security
**Priority**: P1
**Preconditions**: User A created event E
**Steps**:
1. User B `POST /api/bookings` with `eventId: E`
**Expected Results**: 404 "Event with id E not found"
**Business Rule**: Users see only static + own events
**Suggested Layer**: API

---

### TC-207: Unauthenticated booking endpoints return 401
**Category**: Security
**Priority**: P0
**Preconditions**: None
**Steps**:
1. Call each without `Authorization`: `GET /api/bookings`, `GET /api/bookings/1`, `GET /api/bookings/ref/X-AAAAAA`, `POST /api/bookings`, `DELETE /api/bookings`, `DELETE /api/bookings/1`
**Expected Results**: All → 401 `{ success: false, error: "Unauthorized" }`
**Business Rule**: Bearer token required
**Suggested Layer**: API

---

### TC-208: Invalid / tampered token returns 401
**Category**: Security
**Priority**: P1
**Preconditions**: None
**Steps**:
1. `GET /api/bookings` with `Bearer garbage`, and with a valid token whose payload was altered
**Expected Results**: 401 "Invalid or expired token"
**Business Rule**: JWT auth
**Suggested Layer**: API

---

### TC-209: Unauthenticated user visiting /bookings is sent to login
**Category**: Security
**Priority**: P1
**Preconditions**: No token in localStorage
**Steps**:
1. Navigate to `/bookings` and `/bookings/1`
**Expected Results**: Redirected to `/login`; no booking data shown
**Business Rule**: 401 interceptor clears token and redirects
**Suggested Layer**: E2E

---

### TC-210: userId in request body cannot spoof ownership
**Category**: Security
**Priority**: P1
**Preconditions**: Token for user B; user A's id known
**Steps**:
1. `POST /api/bookings` with valid body plus `"userId": <A>`
2. A lists bookings
**Expected Results**: Booking is owned by B; it does not appear in A's list
**Business Rule**: Ownership derived from JWT only
**Suggested Layer**: API

---

### TC-211: XSS payload in customer name is rendered as text
**Category**: Security
**Priority**: P2
**Preconditions**: Logged in
**Steps**:
1. Book with customerName `<img src=x onerror=alert(1)>`
2. Open booking detail and admin bookings modal
**Expected Results**: Name is displayed literally; no dialog/script executes
**Business Rule**: Input safety (discovered: names stored unsanitized)
**Suggested Layer**: E2E

---

## Negative

### TC-300: Non-existent booking id shows "Booking not found" (UI)
**Category**: Negative
**Priority**: P1
**Preconditions**: Logged in
**Steps**:
1. Navigate to `/bookings/99999999`
**Expected Results**: "Booking not found" / "This booking doesn't exist or may have been cancelled." with "View My Bookings" button
**Business Rule**: Error handling
**Suggested Layer**: E2E

---

### TC-301: Non-existent booking id / ref returns 404 (API)
**Category**: Negative
**Priority**: P1
**Preconditions**: Valid JWT
**Steps**:
1. `GET /api/bookings/99999999`
2. `GET /api/bookings/ref/Z-NOPE00`
**Expected Results**: 404 with "Booking with id 99999999 not found" / `Booking with reference "Z-NOPE00" not found`
**Business Rule**: NotFoundError mapping
**Suggested Layer**: API

---

### TC-302: Cancel already-cancelled booking returns 404
**Category**: Negative
**Priority**: P1
**Preconditions**: Booking X just cancelled
**Steps**:
1. `DELETE /api/bookings/X` again
**Expected Results**: 404 "Booking with id X not found"
**Business Rule**: Cancellation is a hard delete [CODE D4]
**Suggested Layer**: API

---

### TC-303: Viewing a cancelled booking's old URL shows "Booking not found"
**Category**: Negative
**Priority**: P2
**Preconditions**: Booking X cancelled
**Steps**:
1. Navigate to `/bookings/X`
**Expected Results**: "Booking not found" state (not "Access Denied")
**Business Rule**: Hard delete
**Suggested Layer**: E2E

---

### TC-304: Missing required fields return 400 with details
**Category**: Negative
**Priority**: P0
**Preconditions**: Valid JWT
**Steps**:
1. `POST /api/bookings` with `{}`
**Expected Results**: 400, `error` = "Validation failed", `details` includes fields eventId, customerName, customerEmail, customerPhone, quantity
**Business Rule**: Missing required fields → 400
**Suggested Layer**: API

---

### TC-305: Invalid field values return 400
**Category**: Negative
**Priority**: P1
**Preconditions**: Valid JWT
**Steps** (one request per row):
1. customerName = "A" → "Customer name must be at least 2 characters"
2. customerName = "   " → "Customer name is required" (trimmed)
3. customerEmail = "not-an-email" → "Customer email must be a valid email address"
4. customerPhone = "12345" → "...at least 10 digits"
5. customerPhone = "98765abcde12" → "...must contain only digits and +, -, spaces, or parentheses"
6. eventId = "abc" / 0 / -1 → "Event ID must be a positive integer"
**Expected Results**: Each → 400 with the matching `details[].message`; no booking created
**Business Rule**: Booking validators
**Suggested Layer**: API (Unit for validator)

---

### TC-306: Quantity outside 1–10 returns 400
**Category**: Negative
**Priority**: P0
**Preconditions**: Valid JWT
**Steps**:
1. POST with quantity 0, -1, 11, 2.5, "abc"
**Expected Results**: 400 "Quantity must be an integer between 1 and 10"
**Business Rule**: Quantity 1–10
**Suggested Layer**: API

---

### TC-307: Booking non-existent event returns 404
**Category**: Negative
**Priority**: P1
**Preconditions**: Valid JWT; fewer than 9 bookings
**Steps**:
1. POST with `eventId: 99999999`
**Expected Results**: 404 "Event with id 99999999 not found"; booking count unchanged
**Business Rule**: Event must exist
**Suggested Layer**: API

---

### TC-308: Insufficient seats returns 400
**Category**: Negative
**Priority**: P0
**Preconditions**: User-created event with totalSeats 3
**Steps**:
1. Book quantity 2 (ok), then book quantity 2 again
**Expected Results**: 2nd → 400 "Only 1 seat(s) available, but 2 requested"
**Business Rule**: Insufficient seats → 400
**Suggested Layer**: API

---

### TC-309: Failed 10th booking still prunes the oldest booking ⚠️
**Category**: Negative
**Priority**: P0
**Preconditions**: Exactly 9 bookings; note the oldest booking id
**Steps**:
1. POST a booking with `eventId: 99999999` (passes validation, fails in service)
2. Repeat with a valid event but quantity > personal available seats
3. `GET /api/bookings`
**Expected Results**: Expected per business intent: 404/400 and **still 9 bookings**. Actual code [D2]: the oldest booking is deleted before the checks, so the count drops to 8. Flag as a defect if reproduced.
**Business Rule**: FIFO pruning on overflow (should only happen when a booking is actually added)
**Suggested Layer**: API

---

### TC-310: Malformed booking id returns a client error, not 500 ⚠️
**Category**: Negative
**Priority**: P2
**Preconditions**: Valid JWT
**Steps**:
1. `GET /api/bookings/abc`, `DELETE /api/bookings/abc`
2. Navigate to `/bookings/abc` in UI
**Expected Results**: Should be 400/404. Code likely returns 500 [D6]. The UI should show "Booking not found", not crash.
**Business Rule**: Error handling
**Suggested Layer**: API + E2E

---

### TC-311: Invalid pagination params ⚠️
**Category**: Negative
**Priority**: P3
**Preconditions**: Valid JWT
**Steps**:
1. `GET /api/bookings?page=0`, `?limit=-5`, `?page=abc&limit=abc`
**Expected Results**: `abc` values fall back to page 1 / limit 10. `page=0` and negative limit should not 500 [D14].
**Business Rule**: Pagination defaults
**Suggested Layer**: API

---

### TC-312: UI form validation blocks invalid booking submissions
**Category**: Negative
**Priority**: P1
**Preconditions**: Logged in; on event detail page
**Steps**:
1. Submit with empty name → "Name must be at least 2 chars"
2. Email "a@b" → "Enter a valid email"
3. Phone "12345" → "Enter a valid 10-digit phone"
**Expected Results**: Inline errors are shown; no POST request is sent (verify via `page.waitForRequest` not firing / network listener)
**Business Rule**: Client-side validation
**Suggested Layer**: Component / E2E

---

### TC-313: Server error on cancel shows error toast
**Category**: Negative
**Priority**: P2
**Preconditions**: Logged in; booking X shown; route-mock `DELETE /api/bookings/X` → 500
**Steps**:
1. Cancel from card and confirm
**Expected Results**: Error toast with server message; dialog closes; card remains
**Business Rule**: Cancel error handling
**Suggested Layer**: E2E (with route mock) / Component

---

### TC-314: Clear all API failure gives no feedback ⚠️
**Category**: Negative
**Priority**: P2
**Preconditions**: Route-mock `DELETE /api/bookings` → 500
**Steps**:
1. Click "Clear all bookings", accept confirm
**Expected Results**: Button returns from "Clearing…" to "Clear all bookings"; bookings still listed. No toast or error message is shown [D5] (UX gap).
**Business Rule**: Clear all
**Suggested Layer**: E2E (route mock)

---

### TC-315: Dismissing clear-all confirm does nothing
**Category**: Negative
**Priority**: P1
**Preconditions**: User has bookings
**Steps**:
1. `page.on('dialog', d => d.dismiss())`, click "Clear all bookings"
**Expected Results**: No `DELETE /api/bookings` request; all bookings remain
**Business Rule**: Clear all requires confirmation
**Suggested Layer**: E2E

---

## Edge Cases

### TC-400: Exactly 9 bookings — no pruning
**Category**: Edge Case
**Priority**: P1
**Preconditions**: Cleared bookings
**Steps**:
1. Create 9 bookings
**Expected Results**: All 9 exist; the first one is not pruned
**Business Rule**: Max 9 (boundary)
**Suggested Layer**: API

---

### TC-401: Quantity boundaries 1 and 10 succeed
**Category**: Edge Case
**Priority**: P1
**Preconditions**: Event with ≥10 personal seats
**Steps**:
1. POST quantity 1, then quantity 10
**Expected Results**: Both 201; totalPrice correct
**Business Rule**: Quantity 1–10
**Suggested Layer**: API

---

### TC-402: UI quantity stepper bounds
**Category**: Edge Case
**Priority**: P1
**Preconditions**: Event with ≥10 seats; second event with 3 seats left
**Steps**:
1. Check "-" is disabled at 1; click "+" until disabled
2. Repeat on the 3-seat event
**Expected Results**: `#ticket-count` stops at 10 and shows "(max 10)"; on the 3-seat event it stops at 3 and shows "(max 3)"
**Business Rule**: maxQty = min(10, availableSeats)
**Suggested Layer**: E2E / Component

---

### TC-403: Booking the last remaining seats → Sold Out
**Category**: Edge Case
**Priority**: P1
**Preconditions**: User-created event with totalSeats 2
**Steps**:
1. Book quantity 2
2. Revisit `/events` and the event page
**Expected Results**: Card shows "Sold Out"; detail shows "SOLD OUT"; Confirm button shows "Sold Out" and is disabled. After cancelling, it becomes bookable again.
**Business Rule**: Seat reduction / restoration
**Suggested Layer**: E2E

---

### TC-404: Refund boundary — quantity 2 is not eligible
**Category**: Edge Case
**Priority**: P1
**Preconditions**: Booking with quantity 2
**Steps**:
1. Check refund eligibility
**Expected Results**: "Group bookings (2 tickets) are non-refundable."
**Business Rule**: >1 ticket not eligible (boundary)
**Suggested Layer**: Component / E2E

---

### TC-405: Same user books the same event multiple times
**Category**: Edge Case
**Priority**: P2
**Preconditions**: Logged in
**Steps**:
1. Book event E twice (qty 1 and qty 2)
**Expected Results**: Two distinct bookings with unique refs (same prefix); seats reduce by 3 total
**Business Rule**: Same user may book same event repeatedly
**Suggested Layer**: API

---

### TC-406: Booking refs are unique across many bookings
**Category**: Edge Case
**Priority**: P2
**Preconditions**: Valid JWT
**Steps**:
1. Create 9 bookings on the same event
**Expected Results**: 9 distinct refs, all with the same prefix, all matching the format
**Business Rule**: Ref uniqueness via collision retry
**Suggested Layer**: API (Unit for `generateUniqueRef` fallback with mocked repo)

---

### TC-407: Event title starting with digit / symbol / emoji
**Category**: Edge Case
**Priority**: P2
**Preconditions**: User creates events "2026 Expo", "#Hackathon", "🎉 Party"
**Steps**:
1. Book each
**Expected Results**: Refs start with "2-" and "#-". The emoji case is a known risk: `title[0]` is half a surrogate pair, producing a malformed prefix [D10]. Record actual behavior.
**Business Rule**: Ref prefix = title[0] uppercased
**Suggested Layer**: API / Unit

---

### TC-408: Same-event fallback on a static event leaks across sandboxes ⚠️
**Category**: Edge Case
**Priority**: P1
**Preconditions**: User A has 9 bookings all on static event S; User B notes S seat count
**Steps**:
1. A makes a 10th booking on S
2. B re-reads S seat count
**Expected Results**: Per isolation rule, B's count should be unchanged. Code [D3] decrements the DB value, so B sees fewer seats. Flag as a defect. (Destructive on shared data — run only against a local DB.)
**Business Rule**: Sandbox isolation; static events immutable
**Suggested Layer**: API (local env only)

---

### TC-409: Email normalization alters stored customer email
**Category**: Edge Case
**Priority**: P2
**Preconditions**: Valid JWT
**Steps**:
1. POST with customerEmail `John.Doe+test@Gmail.com`
**Expected Results**: Stored/displayed email = `johndoe@gmail.com` [D7]. Confirm whether this is intended.
**Business Rule**: Email validation (discovered normalization)
**Suggested Layer**: API

---

### TC-410: API accepts phone with no digits ⚠️
**Category**: Edge Case
**Priority**: P2
**Preconditions**: Valid JWT
**Steps**:
1. POST with customerPhone `----------` and `(((((())))))`
**Expected Results**: Domain rule "min 10 digits" means these should return 400. Code accepts them (201) [D8].
**Business Rule**: Phone min 10 digits
**Suggested Layer**: API / Unit

---

### TC-411: Name / phone whitespace trimming
**Category**: Edge Case
**Priority**: P3
**Preconditions**: Valid JWT
**Steps**:
1. POST with customerName `"  Al  "`, phone `" 9876543210 "`
**Expected Results**: 201; stored values are trimmed ("Al", "9876543210")
**Business Rule**: Validator trims
**Suggested Layer**: API

---

### TC-412: Fractional price display rounding
**Category**: Edge Case
**Priority**: P3
**Preconditions**: User-created event with price 99.50
**Steps**:
1. Book quantity 1; view card and detail
**Expected Results**: API `totalPrice` = 99.5; UI displays "$100" [D9]. Verify that this rounding is acceptable.
**Business Rule**: Price display
**Suggested Layer**: Component / API

---

### TC-413: Free event (price 0)
**Category**: Edge Case
**Priority**: P3
**Preconditions**: User-created event with price 0
**Steps**:
1. Book quantity 3
**Expected Results**: totalPrice = 0; UI shows "$0"
**Business Rule**: price ≥ 0; total = price × qty
**Suggested Layer**: API

---

### TC-414: Double-confirm cancel race
**Category**: Edge Case
**Priority**: P3
**Preconditions**: Booking X open in two tabs
**Steps**:
1. Cancel in tab 1
2. Cancel in tab 2 (stale view)
**Expected Results**: Tab 2 gets error toast "Booking with id X not found"; no crash
**Business Rule**: Hard delete
**Suggested Layer**: E2E

---

### TC-415: Clear all with zero bookings
**Category**: Edge Case
**Priority**: P3
**Preconditions**: No bookings
**Steps**:
1. Click "Clear all bookings" (still visible [D5]), accept
2. `DELETE /api/bookings` via API
**Expected Results**: API 200 "0 booking(s) cleared"; UI remains in empty state without error
**Business Rule**: Clear all
**Suggested Layer**: API + E2E

---

### TC-416: Status filter "cancelled" never returns results
**Category**: Edge Case
**Priority**: P3
**Preconditions**: User has cancelled at least one booking
**Steps**:
1. `GET /api/bookings?status=cancelled`; Admin Bookings → filter "Cancelled"
**Expected Results**: 0 results / "No bookings found" [D4]
**Business Rule**: Status always confirmed; cancel = delete
**Suggested Layer**: API

---

## UI State

### TC-500: Empty state when no bookings
**Category**: UI State
**Priority**: P1
**Preconditions**: All bookings cleared
**Steps**:
1. Go to `/bookings`
**Expected Results**: "No bookings yet", description text, "Browse Events" button navigating to `/events`; no `booking-card`
**Business Rule**: Empty state
**Suggested Layer**: E2E

---

### TC-501: Skeleton loading state on bookings list
**Category**: UI State
**Priority**: P3
**Preconditions**: Route-delay `GET /api/bookings*`
**Steps**:
1. Open `/bookings`
**Expected Results**: 5 skeleton cards (`animate-pulse`) are visible, then replaced by real cards
**Business Rule**: Loading state
**Suggested Layer**: Component

---

### TC-502: Error state with Retry on bookings list
**Category**: UI State
**Priority**: P2
**Preconditions**: Route-mock `GET /api/bookings*` → 500 once
**Steps**:
1. Open `/bookings`; click "Retry" after unmocking
**Expected Results**: "Couldn't load bookings" / "Failed to connect to the server. Please try again."; Retry loads the list
**Business Rule**: Error state
**Suggested Layer**: E2E (route mock) / Component

---

### TC-503: Refund check shows spinner then result (~4s)
**Category**: UI State
**Priority**: P1
**Preconditions**: On a booking detail page
**Steps**:
1. Click `#check-refund-btn`
**Expected Results**: `#refund-spinner` visible immediately with "Checking your refund eligibility…"; button hidden; after ~4s spinner hidden and `#refund-result` visible (use `toBeVisible({ timeout: 6000 })`, not waitForTimeout). Use the Playwright clock API to check the timing exactly.
**Business Rule**: 4-second spinner before result
**Suggested Layer**: E2E / Component

---

### TC-504: Refund button hidden after result; resets on reload
**Category**: UI State
**Priority**: P3
**Preconditions**: Refund result shown
**Steps**:
1. Observe the button, then reload the page
**Expected Results**: Button is absent while the result shows; after reload, the button is back (state not persisted)
**Business Rule**: Client-side refund logic
**Suggested Layer**: Component

---

### TC-505: Cancel confirmation dialog content
**Category**: UI State
**Priority**: P1
**Preconditions**: Booking with ref R, qty N
**Steps**:
1. Click "Cancel Booking" on the card and on the detail page
**Expected Results**: Title "Cancel this booking?"; card description "This will cancel R and release N seat(s) back to the event. This action cannot be undone."; detail description "Cancelling R will release N seat(s) back to the event. This cannot be undone."; buttons "Yes, cancel it" + secondary close
**Business Rule**: Confirmation before cancel
**Suggested Layer**: E2E / Component

---

### TC-506: Closing the cancel dialog keeps the booking
**Category**: UI State
**Priority**: P1
**Preconditions**: Booking dialog open
**Steps**:
1. Close via secondary button, then via Escape
**Expected Results**: No DELETE request; booking still listed
**Business Rule**: Cancel requires confirmation
**Suggested Layer**: E2E

---

### TC-507: "Clearing…" state while clear-all in flight
**Category**: UI State
**Priority**: P3
**Preconditions**: Route-delay `DELETE /api/bookings`
**Steps**:
1. Click "Clear all bookings", accept
**Expected Results**: Button reads "Clearing…" and is disabled until the response
**Business Rule**: Loading feedback
**Suggested Layer**: Component / E2E

---

### TC-508: Ticket pluralization on card
**Category**: UI State
**Priority**: P3
**Preconditions**: Bookings with qty 1 and qty 3
**Steps**:
1. View `/bookings`
**Expected Results**: "1 ticket" and "3 tickets"
**Business Rule**: Display formatting
**Suggested Layer**: Component

---

### TC-509: Pagination not shown with ≤10 bookings
**Category**: UI State
**Priority**: P3
**Preconditions**: 9 bookings (max)
**Steps**:
1. View `/bookings`
**Expected Results**: All 9 cards on one page; no next page available (page size 10 [D11])
**Business Rule**: Max 9 bookings; page size 10
**Suggested Layer**: E2E

---

### TC-510: No sandbox banner on bookings page
**Category**: UI State
**Priority**: P3
**Preconditions**: 9 bookings
**Steps**:
1. View `/bookings`; check `getByText(/sandbox holds up to/i)`
**Expected Results**: Not present on `/bookings` [D13] (banner exists only on `/events`). Resolve the doc discrepancy.
**Business Rule**: Sandbox warning banners
**Suggested Layer**: E2E

---

### TC-511: Lists refresh after booking/cancel (cache invalidation)
**Category**: UI State
**Priority**: P2
**Preconditions**: Logged in
**Steps**:
1. Note event seats on `/events`; book via UI; go to `/bookings` without reloading
2. Cancel from card; navigate to `/events` without reloading
**Expected Results**: New booking appears immediately; event seats reflect booking, then restoration, with no manual reload
**Business Rule**: React Query invalidates `bookings` and `events`
**Suggested Layer**: E2E

---

### TC-512: Detail page loading spinner
**Category**: UI State
**Priority**: P3
**Preconditions**: Route-delay `GET /api/bookings/:id`
**Steps**:
1. Open `/bookings/:id`
**Expected Results**: Large spinner centered, then content
**Business Rule**: Loading state
**Suggested Layer**: Component

---

## Summary

| Category | Count | P0 | IDs |
|---|---|---|---|
| Happy Path | 12 | 7 | TC-001 – TC-012 |
| Business Rule | 16 | 8 | TC-100 – TC-115 |
| Security | 12 | 6 | TC-200 – TC-211 |
| Negative | 16 | 4 | TC-300 – TC-315 |
| Edge Case | 17 | 0 | TC-400 – TC-416 |
| UI State | 13 | 0 | TC-500 – TC-512 |
| **Total** | **86** | **25** | |

Likely defects to raise: D1 (TC-203), D2 (TC-309), D3 (TC-408), D6 (TC-310), D8 (TC-410), D14 (TC-311).

Test-data notes: the default target is the shared deployed site. Start every booking test with `DELETE /api/bookings` for the test account so FIFO state is predictable. Run destructive scenarios that change shared static-event seats (TC-408) only against a local DB.
