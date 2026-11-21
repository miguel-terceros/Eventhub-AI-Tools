import { expect } from '@playwright/test';

export const API_URL = process.env.API_URL ?? 'https://api.eventhub.rahulshettyacademy.com/api';
export const TEST_PASSWORD = 'Magiclife1!';

const auth = (token) => ({ Authorization: `Bearer ${token}` });

/** Registers a throwaway user so tests never wipe data on the shared accounts (strategy A10). */
export async function apiRegisterUser(request) {
  const email = `test+${Date.now()}${Math.floor(Math.random() * 1000)}@eventhub-qa.com`;
  const res = await request.post(`${API_URL}/auth/register`, { data: { email, password: TEST_PASSWORD } });
  expect(res.ok(), `register ${email}: ${res.status()}`).toBeTruthy();
  const body = await res.json();
  return { email, password: TEST_PASSWORD, token: body.token };
}

export async function apiLogin(request, email, password = TEST_PASSWORD) {
  const res = await request.post(`${API_URL}/auth/login`, { data: { email, password } });
  expect(res.ok(), `login ${email}: ${res.status()}`).toBeTruthy();
  return (await res.json()).token;
}

export async function apiClearBookings(request, token) {
  const res = await request.delete(`${API_URL}/bookings`, { headers: auth(token) });
  expect(res.ok(), `clear bookings: ${res.status()}`).toBeTruthy();
}

/**
 * Creates a future-dated event in the user's own sandbox.
 * The seeded static events on the deployed site are all past-dated, so tests can't rely on them.
 */
export async function apiCreateFutureEvent(request, token, { price = 149, totalSeats = 50 } = {}) {
  const eventDate = new Date(Date.now() + 30 * 24 * 60 * 60 * 1000).toISOString();
  const res = await request.post(`${API_URL}/events`, {
    headers: auth(token),
    data: {
      title: `Zenith Expo ${Date.now()}`,
      description: 'Created by booking-journeys E2E tests',
      category: 'Conference',
      venue: 'QA Convention Centre',
      city: 'Bangalore',
      eventDate,
      price,
      totalSeats,
    },
  });
  expect(res.status(), `create event: ${await res.text()}`).toBe(201);
  return (await res.json()).data;
}

export async function apiDeleteEvent(request, token, id) {
  const res = await request.delete(`${API_URL}/events/${id}`, { headers: auth(token) });
  expect(res.ok(), `delete event ${id}: ${res.status()}`).toBeTruthy();
}

export async function apiCreateBooking(request, token, { eventId, quantity = 1 }) {
  const res = await request.post(`${API_URL}/bookings`, {
    headers: auth(token),
    data: {
      eventId,
      quantity,
      customerName: 'QA Tester',
      customerEmail: 'qa.tester@example.com',
      customerPhone: '+91 98765 43210',
    },
  });
  expect(res.status(), `create booking: ${await res.text()}`).toBe(201);
  return (await res.json()).data;
}

export async function apiGetBooking(request, token, id) {
  return request.get(`${API_URL}/bookings/${id}`, { headers: auth(token) });
}

export async function uiLoginWithToken(page, token) {
  await page.addInitScript((t) => localStorage.setItem('eventhub_token', t), token);
}
