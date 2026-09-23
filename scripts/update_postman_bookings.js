/**
 * Upserts the Bookings, Customers and Payments folders into
 * postman_collection.json.
 *
 *   npm run postman:bookings
 *
 * Owns folders "9. Bookings", "10. Customers (Admin)" and "11. Payments
 * (Stripe)"; every other folder is left untouched.
 */
const fs = require('fs');
const path = require('path');

const file = path.join(__dirname, '..', 'postman_collection.json');
if (!fs.existsSync(file)) {
  console.error('postman_collection.json not found — run `npm run postman:auth` first.');
  process.exit(1);
}
const data = JSON.parse(fs.readFileSync(file, 'utf8'));

const VARIABLES = [
  { key: 'bookingId', value: '1' },
  { key: 'bookingRef', value: 'GL-XXXXXX' },
  { key: 'customerId', value: '1' }
];

const url = (p, query) => {
  const raw = `{{baseUrl}}${p}${query ? `?${query.map(q => `${q.key}=${q.value}`).join('&')}` : ''}`;
  const out = { raw, host: ['{{baseUrl}}'], path: p.replace(/^\//, '').split('/') };
  if (query) out.query = query;
  return out;
};
const json = (body) => ({ mode: 'raw', raw: JSON.stringify(body, null, 2), options: { raw: { language: 'json' } } });
const test = (lines) => [{ listen: 'test', script: { type: 'text/javascript', exec: lines } }];
const okTest = (label = 'Request succeeded') => [
  `pm.test("${label}", function () {`,
  '    pm.expect(pm.response.code).to.be.oneOf([200, 201]);',
  '    pm.expect(pm.response.json().success).to.eql(true);',
  '});'
];

const req = ({ name, method, path: p, auth, body, query, description, tests }) => {
  const item = {
    name,
    request: {
      method,
      header: [{ key: 'Content-Type', value: 'application/json' }, ...(auth ? [{ key: 'Authorization', value: `Bearer {{${auth}}}` }] : [])],
      url: url(p, query),
      description
    }
  };
  if (body) item.request.body = json(body);
  if (tests) item.event = test(tests);
  return item;
};

const checkoutPayload = {
  courseId: '{{courseId}}',
  session: { scheduleId: '{{courseLocationDateId}}' },
  customerDetails: {
    firstName: 'Test',
    lastName: 'Student',
    email: '{{testEmail}}',
    phone: '07000000000',
    dob: '1990-01-01'
  },
  billingAddress: { postcode: 'SW1A 1AA', line1: '1 Test Street', line2: '', city: 'London' },
  packageName: 'Standard',
  options: { easyApply: false },
  paymentMethod: 'card',
  additionalInfo: '',
  totalAmount: 225.5
};

const bookingsFolder = {
  name: '9. Bookings',
  description: 'Checkout, lookups and the admin booking actions. A booking holds its seat for 60 minutes; '
    + 'after that the expiry job cancels it and puts the seat back on sale.',
  item: [
    req({
      name: 'Create Booking (checkout)',
      method: 'POST',
      path: '/bookings',
      body: checkoutPayload,
      description: 'Public. Takes a seat on the chosen session, creates the customer account when the email is new, '
        + 'and returns a PENDING booking. The price comes from the course-location link, not from the payload. '
        + 'A second active booking of the same course is refused, and a full session answers 400.',
      tests: [
        ...okTest('Booking created'),
        'var body = pm.response.json();',
        'if (body.data) {',
        '    pm.collectionVariables.set("bookingId", body.data.id);',
        '    pm.collectionVariables.set("bookingRef", body.data.bookingReference);',
        '}'
      ]
    }),
    req({
      name: 'Get Booking by Reference',
      method: 'GET',
      path: '/bookings/reference/{{bookingRef}}',
      description: 'Public — the booking-success page uses it. A pending booking is re-checked against Stripe first, '
        + 'in case the webhook was delayed.',
      tests: okTest()
    }),
    req({
      name: 'My Booking Status for a Course',
      method: 'GET',
      path: '/bookings/my-status/{{courseId}}',
      auth: 'token',
      description: 'Returns PAID / PENDING / NONE plus the sessions this student already holds.',
      tests: okTest()
    }),
    req({
      name: 'My Enrolled Courses (dashboard)',
      method: 'GET',
      path: '/courses/user/enrolled',
      auth: 'token',
      description: 'Groups the student\'s bookings into upcoming / ongoing / completed / postponed / cancelled with summary stats.',
      tests: okTest()
    }),
    req({
      name: 'List Bookings (admin)',
      method: 'GET',
      path: '/bookings',
      auth: 'adminToken',
      query: [
        { key: 'status', value: 'Confirmed', description: 'Confirmed | Pending | Cancelled | Expired | All Booking Status', disabled: true },
        { key: 'paymentStatus', value: 'Paid', description: 'Pending | Paid | Failed | Refunded | Refund Requested | All Payments', disabled: true },
        { key: 'fromDate', value: '2026-01-01', disabled: true },
        { key: 'toDate', value: '2026-12-31', disabled: true },
        { key: 'search', value: 'student', description: 'name, email, booking id or course title', disabled: true }
      ],
      description: 'One row per customer and course: a paid booking hides an older pending one for the same course.',
      tests: [...okTest(), 'var body = pm.response.json();', 'if (body.data && body.data[0]) { pm.collectionVariables.set("bookingId", body.data[0].id); }']
    }),
    req({ name: 'Get Booking (admin)', method: 'GET', path: '/bookings/{{bookingId}}', auth: 'adminToken', tests: okTest() }),
    req({
      name: 'Update Booking (admin)',
      method: 'PUT',
      path: '/bookings/{{bookingId}}',
      auth: 'adminToken',
      body: { status: 'PAID', paymentStatus: 'Paid' },
      description: 'status: PENDING | PAID | EXPIRED | CANCELLED. paymentStatus: Pending | Paid | Failed | Refunded.',
      tests: okTest('Booking updated')
    }),
    req({
      name: 'Lifecycle: Extend',
      method: 'PUT',
      path: '/bookings/{{bookingId}}/lifecycle',
      auth: 'adminToken',
      body: { action: 'extend', newEndDate: '2027-05-20', reason: 'Extra revision day' },
      description: 'Actions: extend, reschedule, postpone, cancel, complete, resume. Each one is recorded on the '
        + 'customer\'s activity timeline and emails the student.',
      tests: okTest('Lifecycle updated')
    }),
    req({
      name: 'Lifecycle: Reschedule (fee link)',
      method: 'PUT',
      path: '/bookings/{{bookingId}}/lifecycle',
      auth: 'adminToken',
      body: { action: 'reschedule', newStartDate: '2027-06-07', newEndDate: '2027-06-09', reason: 'Student request' },
      description: 'Within 48 hours of the course, or without `forceBypass48h`, the student is sent a £70 payment link and '
        + 'the new dates wait in `pendingReschedule` until the fee is paid. Maximum two reschedules, and only within '
        + 'six months of the original date.',
      tests: okTest('Reschedule pending')
    }),
    req({
      name: 'Lifecycle: Reschedule (no fee)',
      method: 'PUT',
      path: '/bookings/{{bookingId}}/lifecycle',
      auth: 'adminToken',
      body: { action: 'reschedule', newStartDate: '2027-06-07', newEndDate: '2027-06-09', reason: 'Centre closure', forceBypass48h: true },
      description: 'Applies the new dates immediately, with no fee.',
      tests: okTest('Rescheduled')
    }),
    req({
      name: 'Lifecycle: Cancel',
      method: 'PUT',
      path: '/bookings/{{bookingId}}/lifecycle',
      auth: 'adminToken',
      body: { action: 'cancel', reason: 'Customer request' },
      tests: okTest('Cancelled')
    }),
    req({
      name: 'Request Refund (student)',
      method: 'POST',
      path: '/bookings/{{bookingId}}/refund/request',
      auth: 'token',
      body: { reason: 'No longer able to attend' },
      description: 'Only the booking owner, only a PAID booking, and only while the course is still upcoming. '
        + 'Send as multipart/form-data with a `proof` file to attach evidence.',
      tests: okTest('Refund requested')
    }),
    req({
      name: 'Process Refund (admin)',
      method: 'POST',
      path: '/bookings/{{bookingId}}/refund/process',
      auth: 'adminToken',
      body: { action: 'approve', refundType: 'full', deductionAmount: 0, adminNotes: 'Within policy' },
      description: 'approve or reject. Approving refunds at Stripe, cancels the booking, puts the seat back on sale and '
        + 'emails the student. `refundType: "partial"` refunds the total minus `deductionAmount`. Admin or editor.',
      tests: okTest('Refund processed')
    }),
    req({ name: 'Delete Booking (admin)', method: 'DELETE', path: '/bookings/{{bookingId}}', auth: 'adminToken', tests: okTest('Booking deleted') })
  ]
};

const customersFolder = {
  name: '10. Customers (Admin)',
  description: 'The customers table of the admin panel, served from the bookings module.',
  item: [
    req({
      name: 'List Customers',
      method: 'GET',
      path: '/bookings/users',
      auth: 'adminToken',
      query: [
        { key: 'search', value: 'student', description: 'name or email', disabled: true },
        { key: 'fromDate', value: '2026-01-01', disabled: true },
        { key: 'toDate', value: '2026-12-31', disabled: true }
      ],
      description: 'Each customer carries `bookingCount` and `totalSpent` (paid bookings only).',
      tests: [...okTest(), 'var body = pm.response.json();', 'if (body.data && body.data[0]) { pm.collectionVariables.set("customerId", body.data[0].id); }']
    }),
    req({ name: 'Get Customer', method: 'GET', path: '/bookings/users/{{customerId}}', auth: 'adminToken', description: 'Includes the customer\'s bookings and what they have spent.', tests: okTest() }),
    req({
      name: 'Update Customer',
      method: 'PUT',
      path: '/bookings/users/{{customerId}}',
      auth: 'adminToken',
      body: { name: 'Updated Name', phone: '07111111111' },
      tests: okTest('Customer updated')
    }),
    req({ name: 'Delete Customer', method: 'DELETE', path: '/bookings/users/{{customerId}}', auth: 'adminToken', description: 'Removes the account and its bookings.', tests: okTest('Customer removed') }),
    req({
      name: 'Bulk Delete Customers',
      method: 'POST',
      path: '/bookings/users/bulk-delete',
      auth: 'adminToken',
      body: { ids: ['{{customerId}}'] },
      tests: okTest('Customers removed')
    })
  ]
};

const paymentsFolder = {
  name: '11. Payments (Stripe)',
  description: 'Stripe checkout and the webhook. Set STRIPE_SECRET_KEY and STRIPE_WEBHOOK_SECRET in .env; '
    + 'without them these endpoints answer 503.',
  item: [
    req({
      name: 'Create Checkout Session',
      method: 'POST',
      path: '/stripe/create-checkout-session/{{bookingId}}',
      description: 'Returns the hosted Stripe page URL for the booking. Expired or cancelled bookings are refused.',
      tests: okTest('Checkout session created')
    }),
    req({
      name: 'Create Payment Intent',
      method: 'POST',
      path: '/stripe/create-payment-intent/{{bookingId}}',
      description: 'For the embedded card form: returns `clientSecret`. A booking that is already paid answers 400.',
      tests: okTest('Payment intent created')
    }),
    {
      name: 'Webhook (Stripe calls this)',
      request: {
        method: 'POST',
        header: [{ key: 'Content-Type', value: 'application/json' }, { key: 'stripe-signature', value: 't=...,v1=...' }],
        url: url('/stripe/webhook'),
        body: json({ note: 'Stripe sends the real event. Use `stripe listen --forward-to localhost:5000/api/stripe/webhook` to test locally.' }),
        description: 'Handles checkout.session.completed, payment_intent.succeeded and payment_intent.payment_failed. '
          + 'The signature is verified against STRIPE_WEBHOOK_SECRET, so a hand-made request answers 400. '
          + 'A payment arriving after the booking expired is re-seated when a seat is free, or refunded automatically when not.'
      }
    }
  ]
};

for (const v of VARIABLES) {
  if (!data.variable.find(x => x.key === v.key)) data.variable.push({ ...v, type: 'string' });
}
const owned = new Set([bookingsFolder.name, customersFolder.name, paymentsFolder.name]);
data.item = data.item.filter(f => !owned.has(f.name));
data.item.push(bookingsFolder, customersFolder, paymentsFolder);
data.item.sort((a, b) => (parseFloat(a.name) || 0) - (parseFloat(b.name) || 0));

fs.writeFileSync(file, JSON.stringify(data, null, 2) + '\n');
console.log(`Updated ${path.basename(file)}: ${data.item.length} folders, ${data.item.reduce((n, f) => n + f.item.length, 0)} requests.`);
