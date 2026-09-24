/**
 * HTTP-level tests for the admin shell: platform settings, the notification
 * feed, the dashboard and analytics pages, and the weekly report. Also covers
 * the settings toggles now taking effect on alerts and emails.
 */
const request = require('supertest');
const { createMockDb, tokenFor } = require('./helpers/mockDb');

const lastMonth = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).toISOString();
const yesterday = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();

const mockDb = createMockDb({
  users: [
    { id: 1, name: 'Site Admin', email: 'admin@courses4me.test', password: 'Adm1n!Pass', role: 'admin' },
    { id: 2, name: 'Cathy Customer', email: 'cathy@example.test', password: 'Cust0mer!Pass', role: 'customer' },
    { id: 3, name: 'Eddie Editor', email: 'editor@courses4me.test', password: 'Ed1tor!Pass', role: 'editor' }
  ],
  courses: [
    { id: 1, title: 'Door Supervisor Course', category: 'SIA Training', status: 'Published', instructor_name: 'Jane Trainer' },
    { id: 2, title: 'First Aid at Work', category: 'First Aid', status: 'Published' },
    { id: 3, title: 'Draft Course', category: 'Specialist', status: 'Draft', instructor_name: 'Ivan Instructor' }
  ],
  locations: [{ id: 1, name: 'London Centre', status: 'Active' }],
  courseLocations: [{
    id: 1, course_id: 1, location_id: 1, price: 200, status: 'Active',
    dates: [
      { available_seats: 10, booked_seats: 8, start_date: '2027-01-04' }, // 2 left
      { available_seats: 20, booked_seats: 0, start_date: '2027-02-01' }
    ]
  }],
  bookings: [
    { id: 1, user_id: 2, course_id: 1, total_amount: 200, payment_status: 'Paid', status: 'PAID', created_at: yesterday, customer_first_name: 'Cathy', customer_last_name: 'Customer' },
    { id: 2, user_id: 2, course_id: 1, total_amount: 150, payment_status: 'Paid', status: 'PAID', created_at: lastMonth, customer_first_name: 'Cathy', customer_last_name: 'Customer' },
    { id: 3, user_id: 2, course_id: 2, total_amount: 90, payment_status: 'Pending', status: 'PENDING', created_at: yesterday, customer_first_name: 'Cathy', customer_last_name: 'Customer' }
  ]
});

jest.mock('../src/config/db', () => mockDb);
jest.mock('../src/utils/sendEmail', () => jest.fn(async () => ({})));
jest.mock('../src/middlewares/uploadMiddleware', () => ({ fields: () => (req, res, next) => next() }));

const sendEmail = require('../src/utils/sendEmail');
const app = require('../src/app');
const notifyAdmins = require('../src/utils/notifyAdmins');
const isEmailTemplateActive = require('../src/utils/isEmailTemplateActive');
const { sendWeeklyReport, buildDigest } = require('../src/services/weeklyReportService');

const asAdmin = () => `Bearer ${tokenFor(mockDb.findUser('admin@courses4me.test'))}`;
const asCustomer = () => `Bearer ${tokenFor(mockDb.findUser('cathy@example.test'))}`;
const asEditor = () => `Bearer ${tokenFor(mockDb.findUser('editor@courses4me.test'))}`;

describe('GET /api/settings', () => {
  it('creates the row with the defaults on first read', async () => {
    expect(mockDb.state.settings).toBeNull();

    const res = await request(app).get('/api/settings').set('Authorization', asAdmin());
    expect(res.status).toBe(200);
    expect(res.body.data.general.siteName).toBe('courses4me');
    expect(res.body.data.notifications).toMatchObject({ bookingAlerts: true, userRegistration: false });
    expect(res.body.data.emailTemplates.find(t => t.key === 'bookingConfirmation')).toMatchObject({ isActive: true });
    expect(typeof res.body.data._id).toBe('string');
    expect(mockDb.state.settings).not.toBeNull();
  });

  it('is admin only', async () => {
    expect((await request(app).get('/api/settings')).status).toBe(401);
    expect((await request(app).get('/api/settings').set('Authorization', asCustomer())).status).toBe(403);
    expect((await request(app).get('/api/settings').set('Authorization', asEditor())).status).toBe(403);
  });
});

describe('PUT /api/settings', () => {
  it('replaces only the blocks that are sent', async () => {
    const res = await request(app).put('/api/settings').set('Authorization', asAdmin())
      .send({ general: { siteName: 'Courses4Me Ltd', supportEmail: 'help@courses4me.co.uk' } });
    expect(res.status).toBe(200);
    expect(res.body.data.general).toEqual({ siteName: 'Courses4Me Ltd', supportEmail: 'help@courses4me.co.uk' });
    // the other blocks are untouched
    expect(res.body.data.notifications.bookingAlerts).toBe(true);
    expect(res.body.data.emailTemplates.length).toBeGreaterThan(0);
  });

  it('rejects an empty or malformed payload', async () => {
    expect((await request(app).put('/api/settings').set('Authorization', asAdmin()).send({})).status).toBe(400);
    expect((await request(app).put('/api/settings').set('Authorization', asAdmin()).send({ notifications: { bookingAlerts: 'yes' } })).status).toBe(400);
    expect((await request(app).put('/api/settings').set('Authorization', asAdmin()).send({ emailTemplates: [{ title: 'No key' }] })).status).toBe(400);
  });
});

describe('settings now govern alerts and emails', () => {
  it('skips an alert whose category is switched off', async () => {
    await request(app).put('/api/settings').set('Authorization', asAdmin())
      .send({ notifications: { bookingAlerts: false, userRegistration: true } });

    const before = mockDb.state.notifications.length;
    await notifyAdmins({ settingKey: 'bookingAlerts', title: 'New Course Booking', message: 'Should not be stored', type: 'booking' });
    expect(mockDb.state.notifications.length).toBe(before);

    // an enabled category reaches both the admin and the editor
    await notifyAdmins({ settingKey: 'userRegistration', title: 'New User Registration', message: 'Stored', type: 'user' });
    expect(mockDb.state.notifications.length).toBe(before + 2);
  });

  it('reports whether an email template is active', async () => {
    await request(app).put('/api/settings').set('Authorization', asAdmin())
      .send({ emailTemplates: [{ key: 'bookingConfirmation', title: 'Booking Confirmation', isActive: false }] });

    expect(await isEmailTemplateActive('bookingConfirmation')).toBe(false);
    // an unknown key fails open so email is never silently switched off
    expect(await isEmailTemplateActive('paymentReceipt')).toBe(true);
  });
});

describe('notifications', () => {
  beforeAll(async () => {
    await request(app).put('/api/settings').set('Authorization', asAdmin())
      .send({ notifications: { bookingAlerts: true, userRegistration: true } });
  });

  it('returns the signed-in user feed with the unread count', async () => {
    await notifyAdmins({ settingKey: 'bookingAlerts', title: 'New Course Booking', message: 'Someone booked a course', type: 'booking' });

    const res = await request(app).get('/api/notifications').set('Authorization', asAdmin());
    expect(res.status).toBe(200);
    expect(res.body.count).toBe(res.body.data.length);
    expect(res.body.unreadCount).toBeGreaterThan(0);
    expect(res.body.data[0]).toMatchObject({ title: 'New Course Booking', type: 'booking', isRead: false });
    expect(typeof res.body.data[0]._id).toBe('string');

    // a customer never receives admin alerts
    const customer = await request(app).get('/api/notifications').set('Authorization', asCustomer());
    expect(customer.body.data).toHaveLength(0);
    expect(customer.body.unreadCount).toBe(0);
  });

  it('marks one as read, refusing someone else\'s', async () => {
    const feed = await request(app).get('/api/notifications').set('Authorization', asAdmin());
    const target = feed.body.data[0];

    const res = await request(app).put(`/api/notifications/${target.id}/read`).set('Authorization', asAdmin());
    expect(res.status).toBe(200);
    expect(res.body.data.isRead).toBe(true);

    const asSomeoneElse = await request(app).put(`/api/notifications/${target.id}/read`).set('Authorization', asEditor());
    expect(asSomeoneElse.status).toBe(401);

    expect((await request(app).put('/api/notifications/9999/read').set('Authorization', asAdmin())).status).toBe(404);
    expect((await request(app).put('/api/notifications/abc/read').set('Authorization', asAdmin())).status).toBe(400);
  });

  it('marks the whole feed as read', async () => {
    await notifyAdmins({ title: 'Another alert', message: 'Unread', type: 'system' });

    const res = await request(app).put('/api/notifications/readall').set('Authorization', asAdmin());
    expect(res.body).toEqual({ success: true, message: 'All notifications marked as read' });

    const feed = await request(app).get('/api/notifications').set('Authorization', asAdmin());
    expect(feed.body.unreadCount).toBe(0);
    expect(feed.body.data.every(n => n.isRead)).toBe(true);
  });

  it('needs a token', async () => {
    expect((await request(app).get('/api/notifications')).status).toBe(401);
    expect((await request(app).put('/api/notifications/readall')).status).toBe(401);
  });
});

describe('GET /api/dashboard', () => {
  it('returns the headline figures, charts and work queues', async () => {
    const res = await request(app).get('/api/dashboard').set('Authorization', asAdmin());
    expect(res.status).toBe(200);

    const { stats, performanceData, categoryData, recentActivity, bookings, lowSeats, pendingApprovals } = res.body.data;
    expect(stats).toEqual({ totalCourses: 3, activeCourses: 2, bookingsInRange: 3, revenueInRange: 350 });

    // six months of points, whether or not there were bookings
    expect(performanceData).toHaveLength(6);
    expect(performanceData.every(p => typeof p.name === 'string' && 'enrollments' in p && 'revenue' in p)).toBe(true);
    expect(performanceData.reduce((acc, p) => acc + p.revenue, 0)).toBe(350);

    // category shares add up over the bookings that have a course
    expect(categoryData.find(c => c.name === 'SIA Training')).toMatchObject({ count: 2 });
    expect(categoryData.every(c => c.color)).toBe(true);

    expect(recentActivity.length).toBeGreaterThan(0);
    expect(recentActivity.length).toBeLessThanOrEqual(5);
    expect(bookings[0]).toMatchObject({ name: 'Cathy Customer', initials: 'CC' });
    expect(bookings[0].price).toMatch(/^£/);

    // the nearly-full session shows up, the roomy one does not
    expect(lowSeats).toHaveLength(1);
    expect(lowSeats[0]).toMatchObject({ course: 'Door Supervisor Course – London Centre', status: '2 left' });

    expect(pendingApprovals).toHaveLength(1);
    expect(pendingApprovals[0]).toMatchObject({ title: 'Draft Course', subtitle: 'Ivan Instructor' });
    expect(pendingApprovals[0].img).toContain('ui-avatars');
  });

  it('honours the date range', async () => {
    const today = new Date().toISOString().slice(0, 10);
    const res = await request(app).get(`/api/dashboard?startDate=${today}&endDate=${today}`).set('Authorization', asAdmin());
    expect(res.status).toBe(200);
    // only the bookings created inside the range are counted
    expect(res.body.data.stats.bookingsInRange).toBe(0);
    expect(res.body.data.stats.revenueInRange).toBe(0);
    // the course totals are not affected by the range
    expect(res.body.data.stats.totalCourses).toBe(3);

    expect((await request(app).get('/api/dashboard?startDate=nonsense').set('Authorization', asAdmin())).status).toBe(400);
  });

  it('is admin only', async () => {
    expect((await request(app).get('/api/dashboard')).status).toBe(401);
    expect((await request(app).get('/api/dashboard').set('Authorization', asCustomer())).status).toBe(403);
  });
});

describe('GET /api/dashboard/analytics', () => {
  it('returns the customer, revenue and top-course series', async () => {
    const res = await request(app).get('/api/dashboard/analytics').set('Authorization', asAdmin());
    expect(res.status).toBe(200);

    const { customerData, revenueData, topCourses } = res.body.data;
    expect(customerData).toHaveLength(6);
    expect(customerData.every(c => 'new' in c && 'returning' in c)).toBe(true);
    expect(revenueData).toHaveLength(6);
    expect(revenueData.reduce((acc, r) => acc + r.value, 0)).toBe(350);

    expect(topCourses[0]).toMatchObject({ name: 'Door Supervisor Course', enrollments: '2', revenue: '£350', share: 100 });
    // ratings arrive with the reviews module
    expect(topCourses[0].rating).toBeNull();
  });

  it('is admin only', async () => {
    expect((await request(app).get('/api/dashboard/analytics').set('Authorization', asCustomer())).status).toBe(403);
  });
});

describe('weekly report', () => {
  it('summarises the last seven days and notifies the admins', async () => {
    const digest = await buildDigest();
    expect(digest.bookingsInRange).toBe(2); // the month-old booking is outside the window
    expect(digest.revenueInRange).toBe(200);
    expect(digest.topCourse).toMatchObject({ title: 'Door Supervisor Course' });

    const before = mockDb.state.notifications.length;
    const message = await sendWeeklyReport();
    expect(message).toMatch(/£200.00 revenue, 2 bookings/);
    expect(mockDb.state.notifications.length).toBeGreaterThan(before);
  });

  it('sends nothing when the weekly report is switched off', async () => {
    await request(app).put('/api/settings').set('Authorization', asAdmin()).send({ notifications: { weeklyReport: false } });

    const before = mockDb.state.notifications.length;
    await sendWeeklyReport();
    expect(mockDb.state.notifications.length).toBe(before);
  });
});
