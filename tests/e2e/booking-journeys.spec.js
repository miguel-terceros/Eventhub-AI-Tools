import { test, expect } from '@playwright/test';
import {
  apiRegisterUser,
  apiClearBookings,
  apiCreateFutureEvent,
  apiDeleteEvent,
  apiCreateBooking,
  apiGetBooking,
  uiLoginWithToken,
} from '../helpers/api.js';

// Booking journeys J1–J3 from docs/test-strategy.md §3.4.
// Each test registers its own throwaway user so clearing bookings never touches the shared accounts,
// and books a future-dated event it creates itself (the seeded static events are all past-dated).

const CUSTOMER = {
  name: 'QA Journey Tester',
  email: 'qa.journey@example.com',
  phone: '+91 98765 43210',
};
const QUANTITY = 2; // > 1 so totalPrice = price × quantity is a real check (business rule §9)
const BOOKING_REF_PATTERN = /^[A-Z0-9]-[A-Z0-9]{6}$/;

// Expected display formats (en-US whole dollars, en-IN dates), computed independently of the page
const usd = (n) => `$${Math.round(Number(n)).toLocaleString('en-US')}`;
const shortDate = (iso) => new Date(iso).toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric' });
const longDate = (iso) =>
  new Date(iso).toLocaleDateString('en-IN', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' });

// Innermost container that holds the given heading (a detail-page section or the confirmation card)
const section = (page, name, level = 2) =>
  page.locator('div').filter({ has: page.getByRole('heading', { level, name, exact: true }) }).last();

// Innermost label/value row inside a scope, found by its exact label text
const row = (page, scope, label) =>
  scope.locator('div').filter({ has: page.getByText(label, { exact: true }) }).last();

test.describe('Booking journeys', () => {
  let user;
  let event;

  test.beforeEach(async ({ request }) => {
    user = undefined;
    event = undefined;
    user = await apiRegisterUser(request);
    event = await apiCreateFutureEvent(request, user.token);
  });

  test.afterEach(async ({ request }) => {
    // Skip cleanup steps whose setup failed, so the original error isn't masked
    if (user) await apiClearBookings(request, user.token);
    if (user && event) await apiDeleteEvent(request, user.token, event.id);
  });

  test('J1 / TC-001, TC-007, TC-002, TC-003: book an event, then view it in the list and on the detail page', async ({ page, request }) => {
    const expectedTotal = usd(Number(event.price) * QUANTITY);

    // -- Step 1: Log in through the UI (the only journey that does) --
    await page.goto('/login');
    await page.getByPlaceholder('you@email.com').fill(user.email);
    await page.getByLabel('Password').fill(user.password);
    await page.locator('#login-btn').click();
    await expect(page.getByTestId('nav-bookings')).toBeVisible();

    // -- Step 2: Open the event from the events list --
    await page.getByTestId('nav-events').click();
    const eventCard = page.getByTestId('event-card').filter({ hasText: event.title }).first();
    await eventCard.getByTestId('book-now-btn').click();
    await expect(page).toHaveURL(new RegExp(`/events/${event.id}$`));
    await expect(page.getByRole('heading', { level: 1, name: event.title })).toBeVisible();

    // -- Step 3: Choose 2 tickets, fill the booking form and confirm --
    await expect(page.locator('#ticket-count')).toHaveText('1');
    await page.getByRole('button', { name: '+', exact: true }).click();
    await expect(page.locator('#ticket-count')).toHaveText(String(QUANTITY));
    await page.getByLabel('Full Name').fill(CUSTOMER.name);
    await page.getByTestId('customer-email').fill(CUSTOMER.email);
    await page.getByPlaceholder('+91 98765 43210').fill(CUSTOMER.phone);
    await page.getByRole('button', { name: 'Confirm Booking' }).click();

    // -- Step 4: Assert confirmation card: ref, tickets, total (TC-001, TC-100 at UI) --
    const confirmation = section(page, 'Booking Confirmed! 🎉', 3);
    await expect(confirmation).toBeVisible();
    const refOnConfirmation = confirmation.locator('.booking-ref'); // no data-testid on the confirmation ref
    await expect(refOnConfirmation).toHaveText(BOOKING_REF_PATTERN);
    const bookingRef = (await refOnConfirmation.textContent()).trim();
    expect(bookingRef[0]).toBe(event.title[0].toUpperCase());
    await expect(row(page, confirmation, 'Customer')).toContainText(CUSTOMER.name);
    await expect(row(page, confirmation, 'Tickets')).toContainText(String(QUANTITY));
    await expect(row(page, confirmation, 'Total')).toContainText(expectedTotal);
    console.log(`Booking confirmed. Ref: ${bookingRef}, total: ${expectedTotal}`);

    // -- Step 5: View My Bookings shows the new booking first (TC-007) --
    await confirmation.getByRole('button', { name: 'View My Bookings' }).click();
    await expect(page).toHaveURL(/\/bookings$/);
    await expect(page.getByRole('heading', { level: 1, name: 'My Bookings' })).toBeVisible();
    const bookingCards = page.getByTestId('booking-card');
    await expect(bookingCards).toHaveCount(1);
    const card = bookingCards.first();
    await expect(card.locator('.booking-ref')).toHaveText(bookingRef);

    // -- Step 6: Card fields (TC-002) --
    await expect(card).toContainText('confirmed');
    await expect(card.getByTestId('booking-id')).toHaveText(/^#\d+$/);
    await expect(card).toContainText(event.title);
    await expect(card).toContainText(shortDate(event.eventDate));
    await expect(card).toContainText(`${QUANTITY} tickets`);
    await expect(card).toContainText(event.city);
    await expect(card).toContainText(/Booked \d{1,2} \w{3} \d{4}/);
    await expect(card).toContainText(expectedTotal);
    await expect(card.getByRole('button', { name: 'View Details' })).toBeVisible();
    await expect(card.getByTestId('cancel-booking-btn')).toBeVisible();
    const bookingId = (await card.getByTestId('booking-id').textContent()).replace('#', '');

    // -- Step 7: Detail page header and breadcrumb (TC-003) --
    await card.getByRole('button', { name: 'View Details' }).click();
    await expect(page).toHaveURL(new RegExp(`/bookings/${bookingId}$`));
    await expect(page.getByRole('heading', { level: 1 })).toHaveText(event.title);
    await expect(page.getByRole('navigation').getByText(bookingRef)).toBeVisible(); // breadcrumb

    // -- Step 8: Each detail section shows its own fields (TC-003) --
    const savedBooking = (await (await apiGetBooking(request, user.token, bookingId)).json()).data;

    const eventDetails = section(page, 'Event Details');
    await expect(row(page, eventDetails, 'Event')).toContainText(event.title);
    await expect(row(page, eventDetails, 'Category')).toContainText(event.category);
    await expect(row(page, eventDetails, 'Date')).toContainText(longDate(event.eventDate));
    await expect(row(page, eventDetails, 'Venue')).toContainText(event.venue);
    await expect(row(page, eventDetails, 'City')).toContainText(event.city);

    const customerDetails = section(page, 'Customer Details');
    await expect(row(page, customerDetails, 'Name')).toContainText(CUSTOMER.name);
    await expect(row(page, customerDetails, 'Email')).toContainText(CUSTOMER.email);
    await expect(row(page, customerDetails, 'Phone')).toContainText(CUSTOMER.phone);

    // -- Step 9: Payment summary: total = price × quantity (business rule §9) --
    const payment = section(page, 'Payment Summary');
    await expect(row(page, payment, 'Tickets')).toContainText(String(QUANTITY));
    await expect(row(page, payment, 'Price per ticket')).toContainText(usd(event.price));
    await expect(row(page, payment, 'Total Paid')).toContainText(expectedTotal);

    // -- Step 10: Refund and booking information sections --
    await expect(section(page, 'Refund').getByTestId('check-refund-btn')).toBeVisible();
    const bookingInfo = section(page, 'Booking Information');
    await expect(row(page, bookingInfo, 'Booked on')).toContainText(longDate(savedBooking.createdAt));
    await expect(row(page, bookingInfo, 'Booking ID')).toContainText(`#${bookingId}`);
  });

  test('J2 / TC-004: cancel a booking from the detail page', async ({ page, request }) => {
    // -- Step 1: Seed a booking via API and inject the token --
    const booking = await apiCreateBooking(request, user.token, { eventId: event.id, quantity: 1 });
    await uiLoginWithToken(page, user.token);

    // -- Step 2: Open the booking detail page --
    await page.goto(`/bookings/${booking.id}`);
    await expect(page.getByRole('heading', { level: 1 })).toHaveText(event.title);

    // -- Step 3: Cancel; the dialog names this booking's ref --
    await page.getByRole('button', { name: 'Cancel Booking' }).click();
    const dialog = page.getByRole('dialog', { name: 'Cancel this booking?' });
    await expect(dialog).toContainText(booking.bookingRef);
    await dialog.getByTestId('confirm-dialog-yes').click();

    // -- Step 4: Toast, redirect, and booking gone from list --
    await expect(page.getByText('Booking cancelled successfully')).toBeVisible();
    await expect(page).toHaveURL(/\/bookings$/);
    await expect(page.getByRole('heading', { level: 1, name: 'My Bookings' })).toBeVisible();
    await expect(page.getByText('No bookings yet')).toBeVisible();
    await expect(
      page.getByTestId('booking-card').filter({ hasText: booking.bookingRef })
    ).toHaveCount(0);

    // -- Step 5: Backend confirms deletion --
    const res = await apiGetBooking(request, user.token, booking.id);
    expect(res.status()).toBe(404);
  });

  test('J3 / TC-005: cancel a booking from the list keeps the user on /bookings', async ({ page, request }) => {
    // -- Step 1: Seed two bookings via API and inject the token --
    const toCancel = await apiCreateBooking(request, user.token, { eventId: event.id, quantity: 1 });
    const toKeep = await apiCreateBooking(request, user.token, { eventId: event.id, quantity: 1 });
    await uiLoginWithToken(page, user.token);

    // -- Step 2: Open the bookings list --
    await page.goto('/bookings');
    const bookingCards = page.getByTestId('booking-card');
    await expect(bookingCards).toHaveCount(2);

    // -- Step 3: Cancel one booking from its card; the dialog names that booking's ref --
    const cardToCancel = bookingCards.filter({ hasText: toCancel.bookingRef });
    await cardToCancel.getByTestId('cancel-booking-btn').click();
    const dialog = page.getByRole('dialog', { name: 'Cancel this booking?' });
    await expect(dialog).toContainText(toCancel.bookingRef);
    await expect(dialog).not.toContainText(toKeep.bookingRef);
    await dialog.getByTestId('confirm-dialog-yes').click();

    // -- Step 4: Toast shown, still on list, only the other booking remains --
    await expect(page.getByText('Booking cancelled successfully')).toBeVisible();
    await expect(page).toHaveURL(/\/bookings$/);
    await expect(bookingCards).toHaveCount(1);
    await expect(cardToCancel).toHaveCount(0);
    await expect(bookingCards.filter({ hasText: toKeep.bookingRef })).toBeVisible();

    // -- Step 5: Backend confirms only the cancelled booking is gone --
    expect((await apiGetBooking(request, user.token, toCancel.id)).status()).toBe(404);
    expect((await apiGetBooking(request, user.token, toKeep.id)).status()).toBe(200);
  });
});
