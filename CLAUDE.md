# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview
EventHub is a full-stack event ticket booking platform built for QA training. Users can browse events, book tickets, manage bookings, and create events. Each user operates in an isolated sandbox (see "Per-User Sandbox Model" below).

## Tech Stack
- **Frontend**: Next.js 14 (App Router), React 18, TypeScript (mixed with `.jsx`), Tailwind CSS, React Query v5, Axios
- **Backend**: Express.js, Prisma ORM, MySQL 8+, express-validator, Swagger (swagger-jsdoc)
- **Auth**: JWT (7-day expiry), bcryptjs
- **Testing**: Playwright E2E (Chromium only)

## Commands
```bash
npm run setup        # Install deps in backend/ and frontend/
npm run db:push      # Push Prisma schema to MySQL (non-interactive)
npm run migrate      # prisma migrate dev (interactive)
npm run seed         # Seed 10 static events
npm run dev          # Start backend (3001, nodemon) + frontend (3000) concurrently
npm run build        # Build frontend
npm run lint         # next lint (frontend only; backend has no linter)
npm run test         # Run all Playwright tests
npm run test:ui      # Playwright UI mode
npm run test:report  # Open last HTML report
npx playwright test tests/<layer>/<file>.spec.js --reporter=line   # Single file
npx playwright test -g "<test title>" --reporter=line      # Single test by name
docker compose run --rm tests                               # Run tests in Playwright container
```

Swagger UI: http://localhost:3001/api/docs. Health: `GET /api/health`.

Env: `backend/.env` needs `DATABASE_URL`, `PORT`, `CORS_ORIGIN`, optional `JWT_SECRET`; `frontend/.env.local` needs `NEXT_PUBLIC_API_URL=http://localhost:3001/api`.

**Important:** Playwright tests target the **deployed** site `https://eventhub.rahulshettyacademy.com` (`baseURL` in `playwright.config.ts`, and existing specs hardcode `BASE_URL`), not localhost. A local server is not needed to run tests; to test local changes, override the base URL.

## Architecture
Backend (`backend/`): `server.js` → `app.js` (CORS, routes, Swagger) → layered `src/`:
Routes (Swagger JSDoc + validators) → Controllers (thin) → Services (business rules) → Repositories (Prisma) → MySQL.
- Domain errors in `src/utils/errors.js` (NotFound, Forbidden, InsufficientSeats, Validation) are thrown from services and mapped to HTTP responses by `middleware/errorHandler.js`.
- All `/api/events` and `/api/bookings` routes require `Authorization: Bearer <jwt>` (`router.use(authMiddleware)`); `/api/auth/register|login` are public, `/api/auth/me` is protected.
- Responses use the envelope `{ success, data, pagination? }`.

Frontend (`frontend/`): App Router pages in `app/` (events, bookings, admin, login, register). `lib/api/client.js` is the Axios instance — it attaches the JWT from `localStorage['eventhub_token']`, unwraps responses to the body, and redirects to `/login` on 401. Data fetching goes through React Query hooks in `lib/hooks/`.

### Per-User Sandbox Model
Data models: `User`, `Event` (`isStatic`, nullable `userId`), `Booking` (`userId`, `eventId`).
- A user sees static (seeded) events plus only their own created events (repository `OR: [{ isStatic: true }, { userId }]`).
- `availableSeats` returned by the API is **computed per user**: DB value minus that user's booked quantity (`withPersonalSeats` in `eventService.js`). Booking/cancelling normally does not write to `Event.availableSeats`, so users never affect each other's seat counts.
- Ownership checks live in services and throw `ForbiddenError` (UI shows "Access Denied").

## Key Business Rules
- Max 6 user-created events per user — FIFO prunes the oldest on overflow (`eventService.js`)
- Max 9 bookings per user — FIFO prunes the oldest, preferring a booking for a *different* event; if it must prune a same-event booking, it permanently decrements that event's seats so the count still drops (`bookingService.js`)
- Booking ref format: `<first char of event title, uppercased>-<base36 timestamp>` (README's `EVT-XXXXXX` is outdated)
- Seat count reduces on booking, restores on cancellation (per-user view)
- Refund eligibility: 1 ticket = eligible, >1 ticket = not eligible (client-side only)
- Static events cannot be edited or deleted
- `DELETE /api/bookings` clears all of the current user's bookings

## Testing Conventions
- Test files go in `tests/<layer>/<feature-name>.spec.js`, where layer is `e2e`, `api`, `ui` or `unit` (see `docs/test-strategy.md` §2); JavaScript, ES module imports. Shared helpers live in `tests/helpers/`
- Locator priority: data-testid > role > label/placeholder > ID > CSS class (data-testid list is in README.md)
- No `page.waitForTimeout()` — use `expect().toBeVisible()`
- Tests must be self-contained (login → action → assert); `fullyParallel: false`, no retries
- Test account: `rahulshetty1@gmail.com` / `Magiclife1!`
- Reference docs: `docs/test-scenarios.md`, `docs/test-strategy.md`

## Code Style
- Backend: CommonJS JavaScript with JSDoc; new routes need Swagger JSDoc blocks like existing ones
- Frontend: TypeScript for new code, React hooks, Tailwind utility classes
- Tests: add step comments
