/**
 * HTTP-level tests for bookings and payments: checkout, seat inventory,
 * duplicate protection, the admin bookings and customers tables, lifecycle
 * actions, refunds, the Stripe endpoints and webhook, and the expiry job.
 */
const request = require('supertest');
const { createMockDb, tokenFor, flushPromises } = require('./helpers/mockDb');

const mockDb = createMockDb({
  users: [
    { id: 1, name: 'Site Admin', email: 'admin@courses4me.test', password: 'Adm1n!Pass', role: 'admin' },
    { id: 2, name: 'Cathy Customer', email: 'cathy@example.test', password: 'Cust0mer!Pass', role: 'customer' },
    { id: 3, name: 'Eddie Editor', email: 'editor@courses4me.test', password: 'Ed1tor!Pass', role: 'editor' }
  ],
  courses: [{ id: 1, title: 'Door Supervisor Course', category: 'SIA Training', status: 'Published', base_price: 200 }],
  locations: [{ id: 1, name: 'London Centre', city: 'London', postcode: 'SW1A 1AA', status: 'Active' }],
  courseLocations: [{
    id: 1, course_id: 1, location_id: 1, price: 225.5, status: 'Active',
    dates: [
      { available_seats: 200, booked_seats: 0, start_date: '2027-01-04', end_date: '2027-01-06' },
      { available_seats: 1, booked_seats: 0, start_date: '2027-02-01', end_date: '2027-02-03' }
    ]
  }]
});

jest.mock('../src/config/db', () => mockDb);
jest.mock('../src/utils/sendEmail', () => jest.fn(async () => ({})));
jest.mock('../src/middlewares/uploadMiddleware', () => ({ fields: () => (req, res, next) => next() }));
jest.mock('../src/middlewares/uploadProofMiddleware', () => ({ single: () => (req, res, next) => next() }));
jest.mock('../src/services/stripeService', () => ({
  isConfigured: () => true,
  createCheckoutSession: jest.fn(async () => ({ id: 'cs_test_123', url: 'https://checkout.stripe.test/cs_test_123' })),
  createPaymentIntent: jest.fn(async () => ({ id: 'pi_test_123', client_secret: 'pi_test_123_secret' })),
  createRescheduleCheckout: jest.fn(async () => 'https://checkout.stripe.test/reschedule'),
  confirmCheckoutSession: jest.fn(async () => false),
  paymentIntentOfSession: jest.fn(async () => 'pi_from_session'),
  refund: jest.fn(async () => ({ ok: true, id: 're_test_123' })),
  constructWebhookEvent: jest.fn()
}));

const sendEmail = require('../src/utils/sendEmail');
const stripeService = require('../src/services/stripeService');
const app = require('../src/app');
const { expirePendingBookings } = require('../src/services/bookingExpiryService');

const asAdmin = () => `Bearer ${tokenFor(mockDb.findUser('admin@courses4me.test'))}`;
const asCustomer = () => `Bearer ${tokenFor(mockDb.findUser('cathy@example.test'))}`;
const asEditor = () => `Bearer ${tokenFor(mockDb.findUser('editor@courses4me.test'))}`;
const dateRow = (index) => mockDb.state.courseLocationDates[index];
const subjects = () => sendEmail.mock.calls.map(([m]) => m.subject);

const checkout = (overrides = {}) => ({
  courseId: 1,
  session: { scheduleId: dateRow(0).id },
  customerDetails: {
    firstName: 'New', lastName: 'Student', email: 'new.student@example.test',
    phone: '07000 000001', dob: '1990-01-01'
  },
  billingAddress: { postcode: 'SW1A 1AA', line1: '1 Test Street', city: 'London' },
  packageName: 'Standard',
  paymentMethod: 'card',
  totalAmount: 225.5,
  ...overrides
});

describe('POST /api/bookings', () => {
  it('books a seat, creates the customer account and emails the confirmation', async () => {
    const seatsBefore = dateRow(0).booked_seats;
    sendEmail.mockClear();

    const res = await request(app).post('/api/bookings').send(checkout());
    expect(res.status).toBe(201);

    const booking = res.body.data;
    expect(booking.bookingReference).toMatch(/^GL-/);
    expect(booking).toMatchObject({ status: 'PENDING', paymentStatus: 'Pending', totalAmount: 225.5 });
    expect(typeof booking._id).toBe('string');
    // the price comes from the course-location link, not the posted amount
    expect(booking.session).toMatchObject({ price: 225.5, locationName: 'London Centre', scheduleSource: 'course_location_date' });
    expect(booking.course).toMatchObject({ _id: '1', title: 'Door Supervisor Course' });
    expect(booking.user).toMatchObject({ email: 'new.student@example.test' });

    // one seat taken, an account created with a hashed password
    expect(dateRow(0).booked_seats).toBe(seatsBefore + 1);
    const created = mockDb.findUser('new.student@example.test');
    expect(created.role).toBe('customer');
    expect(created.password_hash).toMatch(/^\$2[aby]\$/);

    await flushPromises();
    expect(subjects().some(s => /Booking Confirmation/.test(s))).toBe(true);
  });

  it('refuses a second active booking of the same course', async () => {
    const first = await request(app).post('/api/bookings').send(checkout({
      customerDetails: { ...checkout().customerDetails, email: 'dupe@example.test' }
    }));
    expect(first.status).toBe(201);

    const again = await request(app).post('/api/bookings').send(checkout({
      customerDetails: { ...checkout().customerDetails, email: 'dupe@example.test' }
    }));
    expect(again.status).toBe(400);
    expect(again.body.message).toMatch(/pending booking for this specific schedule/i);
    expect(again.body.existingBookingStatus).toBe('PENDING');
  });

  it('will not oversell the last seat', async () => {
    const lastSeat = dateRow(1);
    const first = await request(app).post('/api/bookings').send(checkout({
      session: { scheduleId: lastSeat.id },
      customerDetails: { ...checkout().customerDetails, email: 'seat1@example.test' }
    }));
    expect(first.status).toBe(201);
    expect(lastSeat.booked_seats).toBe(1);

    const second = await request(app).post('/api/bookings').send(checkout({
      session: { scheduleId: lastSeat.id },
      customerDetails: { ...checkout().customerDetails, email: 'seat2@example.test' }
    }));
    expect(second.status).toBe(400);
    expect(second.body.message).toMatch(/sold out/i);
    expect(lastSeat.booked_seats).toBe(1); // unchanged
    expect(mockDb.findUser('seat2@example.test')).toBeUndefined(); // nothing was written
  });

  it('rejects an unknown course, an unknown schedule and a bad payload', async () => {
    expect((await request(app).post('/api/bookings').send(checkout({ courseId: 999 }))).status).toBe(404);
    expect((await request(app).post('/api/bookings').send(checkout({ session: { scheduleId: 9999 } }))).status).toBe(400);

    const invalid = await request(app).post('/api/bookings').send({ courseId: 1 });
    expect(invalid.status).toBe(400);
    expect(invalid.body.errors.map(e => e.field)).toEqual(
      expect.arrayContaining(['session', 'customerDetails', 'billingAddress', 'totalAmount'])
    );

    const badPhone = await request(app).post('/api/bookings').send(checkout({
      customerDetails: { ...checkout().customerDetails, email: 'bad.phone@example.test', phone: 'abc' }
    }));
    expect(badPhone.status).toBe(400);
  });

  it('refuses a session that has already started', async () => {
    const past = dateRow(0);
    const originalStart = past.start_date;
    past.start_date = '2020-01-01';
    const res = await request(app).post('/api/bookings').send(checkout({
      customerDetails: { ...checkout().customerDetails, email: 'late@example.test' }
    }));
    past.start_date = originalStart;

    expect(res.status).toBe(400);
    expect(res.body.message).toMatch(/already started/i);
  });
});

describe('GET /api/bookings (admin)', () => {
  it('lists bookings with user, course and lifecycle status', async () => {
    const res = await request(app).get('/api/bookings').set('Authorization', asAdmin());
    expect(res.status).toBe(200);
    expect(res.body.count).toBe(res.body.data.length);
    const b = res.body.data[0];
    expect(b.user).toHaveProperty('email');
    expect(b.course).toHaveProperty('title');
    expect(b.lifecycleStatus).toBe('Upcoming'); // sessions are in the future
  });

  it('filters by the labels the page sends and by search', async () => {
    const confirmed = await request(app).get('/api/bookings?status=Confirmed').set('Authorization', asAdmin());
    expect(confirmed.body.data.every(b => b.status === 'PAID')).toBe(true);

    const all = await request(app).get('/api/bookings?status=All Booking Status').set('Authorization', asAdmin());
    expect(all.body.count).toBeGreaterThan(0);

    const search = await request(app).get('/api/bookings?search=dupe@example.test').set('Authorization', asAdmin());
    expect(search.body.data.every(b => b.customerDetails.email === 'dupe@example.test')).toBe(true);
  });

  it('includes the whole of the to-date day', async () => {
    const today = new Date().toISOString().slice(0, 10);
    const res = await request(app).get(`/api/bookings?search=&fromDate=2020-01-01&toDate=${today}`).set('Authorization', asAdmin());
    expect(res.status).toBe(200);
    expect(res.body.count).toBeGreaterThan(0);

    const before = await request(app).get('/api/bookings?toDate=2020-01-01').set('Authorization', asAdmin());
    expect(before.body.count).toBe(0);
  });

  it('requires an admin', async () => {
    expect((await request(app).get('/api/bookings')).status).toBe(401);
    expect((await request(app).get('/api/bookings').set('Authorization', asCustomer())).status).toBe(403);
  });
});

describe('booking lookups', () => {
  it('finds a booking by reference without a token', async () => {
    const created = await request(app).post('/api/bookings').send(checkout({
      customerDetails: { ...checkout().customerDetails, email: 'byref@example.test' }
    }));
    const ref = created.body.data.bookingReference;

    const res = await request(app).get(`/api/bookings/reference/${ref}`);
    expect(res.status).toBe(200);
    expect(res.body.data.bookingReference).toBe(ref);

    expect((await request(app).get('/api/bookings/reference/GL-NOPE')).status).toBe(404);
  });

  it('reports the current user booking status for a course', async () => {
    const cathy = mockDb.findUser('cathy@example.test');
    const none = await request(app).get('/api/bookings/my-status/1').set('Authorization', asCustomer());
    expect(none.body).toEqual({ success: true, status: 'NONE', bookedSchedules: [] });

    await request(app).post('/api/bookings').send(checkout({
      customerDetails: { ...checkout().customerDetails, email: cathy.email }
    }));

    const res = await request(app).get('/api/bookings/my-status/1').set('Authorization', asCustomer());
    expect(res.body.status).toBe('PENDING');
    expect(res.body.bookedSchedules[0]).toMatchObject({ status: 'PENDING' });
    expect(typeof res.body.bookedSchedules[0].scheduleId).toBe('string');
  });

  it('groups the student dashboard by lifecycle', async () => {
    const res = await request(app).get('/api/courses/user/enrolled').set('Authorization', asCustomer());
    expect(res.status).toBe(200);
    expect(res.body).toHaveProperty('stats');
    expect(Array.isArray(res.body.upcoming)).toBe(true);
    expect(res.body.pendingBookings.length).toBeGreaterThan(0);
  });
});

describe('admin booking actions', () => {
  let bookingId;

  beforeAll(async () => {
    const created = await request(app).post('/api/bookings').send(checkout({
      customerDetails: { ...checkout().customerDetails, email: 'lifecycle@example.test' }
    }));
    bookingId = created.body.data.id;
  });

  it('updates the status and payment status', async () => {
    const res = await request(app).put(`/api/bookings/${bookingId}`).set('Authorization', asAdmin())
      .send({ status: 'PAID', paymentStatus: 'Paid' });
    expect(res.status).toBe(200);
    expect(res.body.data).toMatchObject({ status: 'PAID', paymentStatus: 'Paid' });

    expect((await request(app).put('/api/bookings/9999').set('Authorization', asAdmin()).send({ status: 'PAID' })).status).toBe(404);
    expect((await request(app).put(`/api/bookings/${bookingId}`).set('Authorization', asAdmin()).send({ status: 'NOPE' })).status).toBe(400);
  });

  it('extends, postpones, resumes and cancels through the lifecycle endpoint', async () => {
    const extended = await request(app).put(`/api/bookings/${bookingId}/lifecycle`).set('Authorization', asAdmin())
      .send({ action: 'extend', newEndDate: '2027-01-10', reason: 'Snow day' });
    expect(extended.status).toBe(200);
    expect(extended.body.data.extensionHistory).toHaveLength(1);
    expect(extended.body.data.originalEndDate).not.toBeNull();

    const missingDate = await request(app).put(`/api/bookings/${bookingId}/lifecycle`).set('Authorization', asAdmin()).send({ action: 'extend' });
    expect(missingDate.status).toBe(400);

    const postponed = await request(app).put(`/api/bookings/${bookingId}/lifecycle`).set('Authorization', asAdmin()).send({ action: 'postpone' });
    expect(postponed.body.data.lifecycleStatus).toBe('Postponed');

    const resumed = await request(app).put(`/api/bookings/${bookingId}/lifecycle`).set('Authorization', asAdmin()).send({ action: 'resume' });
    // recalculated from the dates: the course has not started yet
    expect(resumed.body.lifecycleStatus).toBe('Upcoming');

    const cancelled = await request(app).put(`/api/bookings/${bookingId}/lifecycle`).set('Authorization', asAdmin())
      .send({ action: 'cancel', reason: 'Customer request' });
    expect(cancelled.body.data).toMatchObject({ status: 'CANCELLED', lifecycleStatus: 'Cancelled' });

    expect((await request(app).put(`/api/bookings/${bookingId}/lifecycle`).set('Authorization', asAdmin()).send({ action: 'explode' })).status).toBe(400);
  });

  it('asks for a fee before rescheduling, unless the notice period is bypassed', async () => {
    const created = await request(app).post('/api/bookings').send(checkout({
      customerDetails: { ...checkout().customerDetails, email: 'reschedule@example.test' }
    }));
    const id = created.body.data.id;

    const withFee = await request(app).put(`/api/bookings/${id}/lifecycle`).set('Authorization', asAdmin())
      .send({ action: 'reschedule', newStartDate: '2027-01-18', newEndDate: '2027-01-20', reason: 'Clash' });
    expect(withFee.status).toBe(200);
    expect(withFee.body.data.pendingReschedule).toMatchObject({ status: 'Awaiting Payment' });
    // The dates only apply once the fee is paid, so the customer has to be
    // sent the link to pay it.
    const feeEmail = sendEmail.mock.calls
      .map(([m]) => m)
      .find(m => String(m.html).includes('https://checkout.stripe.test/reschedule'));
    expect(feeEmail).toBeDefined();
    expect(feeEmail.html).toContain('Pay Rescheduling Fee (£70)');
    expect(withFee.body.data.session.startDate).not.toContain('2027-01-18'); // not applied yet

    const bypassed = await request(app).put(`/api/bookings/${id}/lifecycle`).set('Authorization', asAdmin())
      .send({ action: 'reschedule', newStartDate: '2027-01-25', newEndDate: '2027-01-27', forceBypass48h: true });
    expect(bypassed.body.data.rescheduleHistory).toHaveLength(1);

    const tooFar = await request(app).put(`/api/bookings/${id}/lifecycle`).set('Authorization', asAdmin())
      .send({ action: 'reschedule', newStartDate: '2028-06-01', newEndDate: '2028-06-03', forceBypass48h: true });
    expect(tooFar.status).toBe(400);
    expect(tooFar.body.message).toMatch(/six months/i);
  });

  it('deletes a booking', async () => {
    const created = await request(app).post('/api/bookings').send(checkout({
      customerDetails: { ...checkout().customerDetails, email: 'deleteme@example.test' }
    }));
    const id = created.body.data.id;

    const res = await request(app).delete(`/api/bookings/${id}`).set('Authorization', asAdmin());
    expect(res.body).toEqual({ success: true, data: {} });
    expect((await request(app).delete(`/api/bookings/${id}`).set('Authorization', asAdmin())).status).toBe(404);
  });
});

describe('refunds', () => {
  let bookingId;
  let owner;

  beforeAll(async () => {
    owner = mockDb.findUser('cathy@example.test');
    const created = await request(app).post('/api/bookings').send(checkout({
      courseId: 1,
      session: { scheduleId: dateRow(0).id },
      customerDetails: { ...checkout().customerDetails, email: 'refund.owner@example.test' }
    }));
    bookingId = created.body.data.id;
    // the refund flow only applies to paid bookings that were paid at Stripe
    await request(app).put(`/api/bookings/${bookingId}`).set('Authorization', asAdmin()).send({ status: 'PAID', paymentStatus: 'Paid' });
    mockDb.state.bookings.find(b => b.id === bookingId).payment_intent_id = 'pi_paid_booking';
  });

  const asOwner = () => `Bearer ${tokenFor(mockDb.findUser('refund.owner@example.test'))}`;

  it('accepts a request from the owner only, and only for a paid upcoming course', async () => {
    expect((await request(app).post(`/api/bookings/${bookingId}/refund/request`).set('Authorization', asCustomer()).send({ reason: 'Nope' })).status).toBe(403);

    const noReason = await request(app).post(`/api/bookings/${bookingId}/refund/request`).set('Authorization', asOwner()).send({});
    expect(noReason.status).toBe(400);

    const res = await request(app).post(`/api/bookings/${bookingId}/refund/request`).set('Authorization', asOwner())
      .send({ reason: 'Cannot attend any more' });
    expect(res.status).toBe(200);
    expect(res.body.data.refundRequest).toMatchObject({ status: 'Requested', reason: 'Cannot attend any more' });

    await flushPromises();
    expect(subjects().some(s => /Refund Request Received/.test(s))).toBe(true);
  });

  it('refunds at Stripe on approval, frees the seat and cancels the booking', async () => {
    const seatsBefore = dateRow(0).booked_seats;
    stripeService.refund.mockClear();

    const res = await request(app).post(`/api/bookings/${bookingId}/refund/process`).set('Authorization', asAdmin())
      .send({ action: 'approve', adminNotes: 'Within policy' });
    expect(res.status).toBe(200);
    expect(stripeService.refund).toHaveBeenCalled();
    expect(res.body.data).toMatchObject({ paymentStatus: 'Refunded', status: 'CANCELLED', lifecycleStatus: 'Cancelled' });
    expect(res.body.data.refundRequest).toMatchObject({ status: 'Approved', refundId: 're_test_123' });
    expect(dateRow(0).booked_seats).toBe(seatsBefore - 1);

    const again = await request(app).post(`/api/bookings/${bookingId}/refund/process`).set('Authorization', asAdmin()).send({ action: 'approve' });
    expect(again.status).toBe(400);
    expect(again.body.message).toMatch(/no active refund request/i);
  });

  it('lets an editor reject a request and validates the action', async () => {
    const created = await request(app).post('/api/bookings').send(checkout({
      customerDetails: { ...checkout().customerDetails, email: 'reject.me@example.test' }
    }));
    const id = created.body.data.id;
    await request(app).put(`/api/bookings/${id}`).set('Authorization', asAdmin()).send({ status: 'PAID', paymentStatus: 'Paid' });
    mockDb.state.bookings.find(b => b.id === id).payment_intent_id = 'pi_reject_booking';
    await request(app).post(`/api/bookings/${id}/refund/request`)
      .set('Authorization', `Bearer ${tokenFor(mockDb.findUser('reject.me@example.test'))}`)
      .send({ reason: 'Changed my mind' });

    const rejected = await request(app).post(`/api/bookings/${id}/refund/process`).set('Authorization', asEditor())
      .send({ action: 'reject', adminNotes: 'Outside the policy window' });
    expect(rejected.status).toBe(200);
    expect(rejected.body.data.refundRequest).toMatchObject({ status: 'Rejected', adminNotes: 'Outside the policy window' });

    expect((await request(app).post(`/api/bookings/${id}/refund/process`).set('Authorization', asAdmin()).send({ action: 'maybe' })).status).toBe(400);
  });
});

describe('customers table', () => {
  it('lists customers with their booking totals', async () => {
    const res = await request(app).get('/api/bookings/users').set('Authorization', asAdmin());
    expect(res.status).toBe(200);
    const withBookings = res.body.data.find(c => c.email === 'dupe@example.test');
    expect(withBookings.bookingCount).toBeGreaterThan(0);
    expect(withBookings).toHaveProperty('totalSpent');

    const search = await request(app).get('/api/bookings/users?search=cathy').set('Authorization', asAdmin());
    expect(search.body.data.map(c => c.email)).toEqual(['cathy@example.test']);
  });

  it('returns one customer with their bookings, updates and deletes them', async () => {
    const created = await request(app).post('/api/bookings').send(checkout({
      customerDetails: { ...checkout().customerDetails, email: 'temp.customer@example.test' }
    }));
    const userId = created.body.data.user.id;

    const one = await request(app).get(`/api/bookings/users/${userId}`).set('Authorization', asAdmin());
    expect(one.status).toBe(200);
    expect(one.body.data.bookings).toHaveLength(1);
    expect(one.body.data.bookingCount).toBe(1);

    const updated = await request(app).put(`/api/bookings/users/${userId}`).set('Authorization', asAdmin()).send({ name: 'Renamed Customer' });
    expect(updated.body.data.name).toBe('Renamed Customer');

    const removed = await request(app).delete(`/api/bookings/users/${userId}`).set('Authorization', asAdmin());
    expect(removed.body.message).toMatch(/removed/i);
    expect(mockDb.state.bookings.some(b => b.user_id === userId)).toBe(false);
    expect((await request(app).get(`/api/bookings/users/${userId}`).set('Authorization', asAdmin())).status).toBe(404);
  });

  it('bulk deletes and validates the id list', async () => {
    const created = await request(app).post('/api/bookings').send(checkout({
      customerDetails: { ...checkout().customerDetails, email: 'bulk@example.test' }
    }));
    const userId = created.body.data.user.id;

    const res = await request(app).post('/api/bookings/users/bulk-delete').set('Authorization', asAdmin()).send({ ids: [userId] });
    expect(res.body.message).toMatch(/1 users/);
    expect((await request(app).post('/api/bookings/users/bulk-delete').set('Authorization', asAdmin()).send({ ids: [] })).status).toBe(400);
  });
});

describe('Stripe endpoints', () => {
  let bookingId;

  beforeAll(async () => {
    const created = await request(app).post('/api/bookings').send(checkout({
      customerDetails: { ...checkout().customerDetails, email: 'stripe@example.test' }
    }));
    bookingId = created.body.data.id;
  });

  it('creates a checkout session and stores its id', async () => {
    const res = await request(app).post(`/api/stripe/create-checkout-session/${bookingId}`).send({});
    expect(res.status).toBe(200);
    expect(res.body.url).toMatch(/checkout.stripe.test/);
    expect(mockDb.state.bookings.find(b => b.id === bookingId).stripe_session_id).toBe('cs_test_123');
  });

  it('creates a payment intent and returns the client secret', async () => {
    const res = await request(app).post(`/api/stripe/create-payment-intent/${bookingId}`).send({});
    expect(res.status).toBe(200);
    expect(res.body.clientSecret).toBe('pi_test_123_secret');
    expect(res.body.bookingReference).toMatch(/^GL-/);
  });

  it('refuses a cancelled or already paid booking, and 404s for an unknown one', async () => {
    await request(app).put(`/api/bookings/${bookingId}`).set('Authorization', asAdmin()).send({ status: 'PAID' });
    const paid = await request(app).post(`/api/stripe/create-payment-intent/${bookingId}`).send({});
    expect(paid.status).toBe(400);
    expect(paid.body.message).toMatch(/already been paid/i);

    await request(app).put(`/api/bookings/${bookingId}`).set('Authorization', asAdmin()).send({ status: 'CANCELLED' });
    const cancelled = await request(app).post(`/api/stripe/create-checkout-session/${bookingId}`).send({});
    expect(cancelled.status).toBe(400);

    expect((await request(app).post('/api/stripe/create-checkout-session/9999').send({})).status).toBe(404);
  });
});

describe('Stripe webhook', () => {
  const fire = (event) => {
    stripeService.constructWebhookEvent.mockReturnValueOnce(event);
    return request(app).post('/api/stripe/webhook').set('stripe-signature', 'sig').send(Buffer.from('{}'));
  };

  it('rejects an event whose signature does not verify', async () => {
    stripeService.constructWebhookEvent.mockImplementationOnce(() => { throw new Error('bad signature'); });
    const res = await request(app).post('/api/stripe/webhook').set('stripe-signature', 'nope').send(Buffer.from('{}'));
    expect(res.status).toBe(400);
  });

  it('marks a booking paid and emails the receipt', async () => {
    const created = await request(app).post('/api/bookings').send(checkout({
      customerDetails: { ...checkout().customerDetails, email: 'webhook.paid@example.test' }
    }));
    const id = created.body.data.id;
    sendEmail.mockClear();

    const res = await fire({
      type: 'checkout.session.completed',
      data: { object: { metadata: { bookingId: String(id) }, payment_intent: 'pi_webhook_1' } }
    });
    expect(res.status).toBe(200);

    const row = mockDb.state.bookings.find(b => b.id === id);
    expect(row).toMatchObject({ status: 'PAID', payment_status: 'Paid', payment_intent_id: 'pi_webhook_1' });
    await flushPromises();
    expect(subjects().some(s => /Payment Received/.test(s))).toBe(true);
  });

  it('records a failed payment and warns the student', async () => {
    const created = await request(app).post('/api/bookings').send(checkout({
      customerDetails: { ...checkout().customerDetails, email: 'webhook.failed@example.test' }
    }));
    const id = created.body.data.id;
    sendEmail.mockClear();

    await fire({
      type: 'payment_intent.payment_failed',
      data: { object: { metadata: { bookingId: String(id) }, last_payment_error: { message: 'Card declined' } } }
    });

    expect(mockDb.state.bookings.find(b => b.id === id).payment_status).toBe('Failed');
    await flushPromises();
    expect(subjects().some(s => /Payment Failed/.test(s))).toBe(true);
  });

  it('applies a pending reschedule once its fee is paid', async () => {
    const created = await request(app).post('/api/bookings').send(checkout({
      customerDetails: { ...checkout().customerDetails, email: 'webhook.reschedule@example.test' }
    }));
    const id = created.body.data.id;
    await request(app).put(`/api/bookings/${id}/lifecycle`).set('Authorization', asAdmin())
      .send({ action: 'reschedule', newStartDate: '2027-03-01', newEndDate: '2027-03-03', reason: 'Clash' });

    await fire({
      type: 'payment_intent.succeeded',
      data: { object: { id: 'pi_resched', metadata: { bookingId: String(id), action: 'reschedulePayment' } } }
    });

    const row = mockDb.state.bookings.find(b => b.id === id);
    expect(String(row.session_start_date)).toContain('2027-03-01');
    expect(row.pending_reschedule_start_date).toBeNull();
    expect(mockDb.state.bookingReschedules.some(r => r.booking_id === id)).toBe(true);
    // The fee is a separate charge: it must not replace the payment the
    // customer made for the course, or a later refund would target £70.
    expect(row.payment_intent_id).not.toBe('pi_resched');
  });

  it('refunds a late payment when the seat has gone', async () => {
    const soldOut = dateRow(1); // the single-seat session, already taken
    const created = await request(app).post('/api/bookings').send(checkout({
      session: { scheduleId: dateRow(0).id },
      customerDetails: { ...checkout().customerDetails, email: 'webhook.late@example.test' }
    }));
    const id = created.body.data.id;

    // the booking expired and its session is now full
    const row = mockDb.state.bookings.find(b => b.id === id);
    row.status = 'EXPIRED';
    row.session_schedule_id = soldOut.id;
    stripeService.refund.mockClear();
    sendEmail.mockClear();

    await fire({
      type: 'checkout.session.completed',
      data: { object: { metadata: { bookingId: String(id) }, payment_intent: 'pi_late' } }
    });

    expect(stripeService.refund).toHaveBeenCalledWith(expect.objectContaining({ paymentIntentId: 'pi_late' }));
    expect(row).toMatchObject({ status: 'EXPIRED', payment_status: 'Refunded' });
    await flushPromises();
    expect(subjects().some(s => /Refund Confirmation/.test(s))).toBe(true);
  });
});

describe('payment window expiry job', () => {
  it('expires unpaid bookings, releases their seats and emails the customer', async () => {
    const created = await request(app).post('/api/bookings').send(checkout({
      customerDetails: { ...checkout().customerDetails, email: 'expiry@example.test' }
    }));
    const id = created.body.data.id;
    const seatsBefore = dateRow(0).booked_seats;

    // nothing to do while the booking is inside its window
    expect(await expirePendingBookings()).toBe(0);

    const row = mockDb.state.bookings.find(b => b.id === id);
    row.created_at = new Date(Date.now() - 2 * 60 * 60 * 1000);
    sendEmail.mockClear();

    expect(await expirePendingBookings()).toBe(1);
    expect(row).toMatchObject({ status: 'EXPIRED', lifecycle_status: 'Cancelled' });
    expect(dateRow(0).booked_seats).toBe(seatsBefore - 1);
    await flushPromises();
    expect(subjects().some(s => /Payment Timeout/.test(s))).toBe(true);
  });
});
