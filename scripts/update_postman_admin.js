/**
 * Upserts the Dashboard, Notifications and Settings folders into
 * postman_collection.json.
 *
 *   npm run postman:admin
 *
 * Owns folders "12. Dashboard & Analytics", "13. Notifications" and
 * "14. Settings"; every other folder is left untouched.
 */
const fs = require('fs');
const path = require('path');

const file = path.join(__dirname, '..', 'postman_collection.json');
if (!fs.existsSync(file)) {
  console.error('postman_collection.json not found — run `npm run postman:auth` first.');
  process.exit(1);
}
const data = JSON.parse(fs.readFileSync(file, 'utf8'));

const VARIABLES = [{ key: 'notificationId', value: '1' }];

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

const dashboardFolder = {
  name: '12. Dashboard & Analytics',
  description: 'The admin home and analytics pages. Both are admin only — they carry revenue figures.',
  item: [
    req({
      name: 'Dashboard',
      method: 'GET',
      path: '/dashboard',
      auth: 'adminToken',
      query: [
        { key: 'startDate', value: '2026-01-01', description: 'filters bookings and revenue only', disabled: true },
        { key: 'endDate', value: '2026-12-31', disabled: true }
      ],
      description: 'Returns `stats` (course totals, bookings and revenue for the range), `performanceData` and '
        + '`categoryData` for the charts, `recentActivity`, the latest `bookings`, `lowSeats` (sessions with 5 seats '
        + 'or fewer, from both scheduling systems) and `pendingApprovals` (draft courses).',
      tests: okTest('Dashboard loaded')
    }),
    req({
      name: 'Analytics',
      method: 'GET',
      path: '/dashboard/analytics',
      auth: 'adminToken',
      description: 'Six months of new against returning customers, six months of paid revenue, and the five courses '
        + 'earning the most with their share of total revenue.',
      tests: okTest('Analytics loaded')
    })
  ]
};

const notificationsFolder = {
  name: '13. Notifications',
  description: 'The bell menu. Notifications are written for admins and editors when an alert category is enabled in '
    + 'Settings; each user only ever sees their own.',
  item: [
    req({
      name: 'My Notifications',
      method: 'GET',
      path: '/notifications',
      auth: 'adminToken',
      description: 'The 20 most recent, newest first, with `unreadCount`.',
      tests: [...okTest(), 'var body = pm.response.json();', 'if (body.data && body.data[0]) { pm.collectionVariables.set("notificationId", body.data[0].id); }']
    }),
    req({
      name: 'Mark One as Read',
      method: 'PUT',
      path: '/notifications/{{notificationId}}/read',
      auth: 'adminToken',
      description: 'Answers 401 for a notification belonging to someone else.',
      tests: okTest('Marked as read')
    }),
    req({ name: 'Mark All as Read', method: 'PUT', path: '/notifications/readall', auth: 'adminToken', tests: okTest('All marked as read') })
  ]
};

const settingsFolder = {
  name: '14. Settings',
  description: 'Platform settings. The row is created with the defaults the first time it is read. '
    + 'The `notifications` toggles decide which alerts are written, and `emailTemplates[].isActive` decides which '
    + 'customer emails are sent.',
  item: [
    req({ name: 'Get Settings', method: 'GET', path: '/settings', auth: 'adminToken', tests: okTest() }),
    req({
      name: 'Update General',
      method: 'PUT',
      path: '/settings',
      auth: 'adminToken',
      body: {
        general: {
          siteName: 'courses4me',
          siteUrl: 'https://www.courses4me.co.uk',
          supportEmail: 'support@courses4me.co.uk',
          phoneNumber: '+44 20 7123 4567',
          companyRegistration: '12345678',
          vatNumber: 'GB 123 456 789'
        }
      },
      description: 'Only the blocks you send are replaced, so this leaves the toggles and templates untouched.',
      tests: okTest('Settings updated')
    }),
    req({
      name: 'Update Notification Toggles',
      method: 'PUT',
      path: '/settings',
      auth: 'adminToken',
      body: {
        notifications: {
          bookingAlerts: true,
          paymentReceived: true,
          paymentAlerts: true,
          seatAvailability: true,
          userRegistration: false,
          courseReview: true,
          weeklyReport: true,
          loginAlert: true
        }
      },
      description: 'Switching a category off stops that alert being written for the admins.',
      tests: okTest('Settings updated')
    }),
    req({
      name: 'Update Email Templates',
      method: 'PUT',
      path: '/settings',
      auth: 'adminToken',
      body: {
        emailTemplates: [
          { key: 'bookingConfirmation', title: 'Booking Confirmation', description: 'Sent immediately after a successful booking', isActive: true },
          { key: 'bookingReminder', title: 'Booking Reminder', description: 'Sent 48 hours before course start date', isActive: true },
          { key: 'paymentReceipt', title: 'Payment Receipt', description: 'Sent after successful payment', isActive: true },
          { key: 'bookingCancellation', title: 'Booking Cancellation', description: 'Sent when a booking is cancelled', isActive: true },
          { key: 'courseCompletion', title: 'Course Completion', description: 'Sent after course is marked complete', isActive: false },
          { key: 'passwordReset', title: 'Password Reset', description: 'Triggered by customer password reset request', isActive: true }
        ]
      },
      description: 'Sending this array replaces the whole list. `isActive: false` stops that email being sent; an '
        + 'unknown key is treated as active so mail is never switched off by accident.',
      tests: okTest('Settings updated')
    })
  ]
};

for (const v of VARIABLES) {
  if (!data.variable.find(x => x.key === v.key)) data.variable.push({ ...v, type: 'string' });
}
const owned = new Set([dashboardFolder.name, notificationsFolder.name, settingsFolder.name]);
data.item = data.item.filter(f => !owned.has(f.name));
data.item.push(dashboardFolder, notificationsFolder, settingsFolder);
data.item.sort((a, b) => (parseFloat(a.name) || 0) - (parseFloat(b.name) || 0));

fs.writeFileSync(file, JSON.stringify(data, null, 2) + '\n');
console.log(`Updated ${path.basename(file)}: ${data.item.length} folders, ${data.item.reduce((n, f) => n + f.item.length, 0)} requests.`);
