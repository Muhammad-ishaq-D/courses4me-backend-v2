/**
 * HTTP-level tests for reviews: who may leave one, updating an existing one
 * rather than duplicating it, and the average score reaching the analytics
 * page.
 */
const request = require('supertest');
const { createMockDb, tokenFor, flushPromises } = require('./helpers/mockDb');

const mockDb = createMockDb({
  users: [
    { id: 1, name: 'Site Admin', email: 'admin@courses4me.test', password: 'Adm1n!Pass', role: 'admin' },
    { id: 2, name: 'Cathy Customer', email: 'cathy@example.test', password: 'Cust0mer!Pass', role: 'customer' },
    { id: 3, name: 'Other Student', email: 'other@example.test', password: 'Other!Pass1', role: 'customer' }
  ],
  courses: [{ id: 1, title: 'Door Supervisor Course', category: 'SIA Training', status: 'Published' }],
  bookings: [
    { id: 1, user_id: 2, course_id: 1, status: 'PAID', payment_status: 'Paid', total_amount: 200 },
    { id: 2, user_id: 2, course_id: 1, status: 'PENDING', payment_status: 'Pending', total_amount: 200 },
    { id: 3, user_id: 3, course_id: 1, status: 'PAID', payment_status: 'Paid', total_amount: 200 }
  ]
});

jest.mock('../src/config/db', () => mockDb);
jest.mock('../src/utils/sendEmail', () => jest.fn(async () => ({})));
jest.mock('../src/middlewares/uploadMiddleware', () => ({ fields: () => (req, res, next) => next() }));

const app = require('../src/app');

const asCustomer = () => `Bearer ${tokenFor(mockDb.findUser('cathy@example.test'))}`;
const asOther = () => `Bearer ${tokenFor(mockDb.findUser('other@example.test'))}`;
const asAdmin = () => `Bearer ${tokenFor(mockDb.findUser('admin@courses4me.test'))}`;

describe('POST /api/reviews', () => {
  it('accepts a review for a paid booking and tells the admins', async () => {
    const res = await request(app).post('/api/reviews').set('Authorization', asCustomer())
      .send({ bookingId: 1, rating: 5, comment: 'Excellent trainer and venue.' });

    expect(res.status).toBe(201);
    expect(res.body.data).toMatchObject({ rating: 5, comment: 'Excellent trainer and venue.', courseModel: 'Course' });
    expect(res.body.data.user).toBe('2');
    expect(res.body.data.course).toBe('1');
    expect(res.body.data.booking).toBe('1');
    expect(typeof res.body.data._id).toBe('string');

    await flushPromises();
    expect(mockDb.state.notifications.some(n => n.title === 'Course Review Submitted')).toBe(true);
  });

  it('updates the existing review instead of adding a second one', async () => {
    const before = mockDb.state.reviews.length;
    mockDb.state.notifications = [];

    const res = await request(app).post('/api/reviews').set('Authorization', asCustomer())
      .send({ bookingId: 1, rating: 3, comment: 'Changed my mind.' });

    // 200, not 201: the review was replaced
    expect(res.status).toBe(200);
    expect(res.body.data.rating).toBe(3);
    expect(mockDb.state.reviews).toHaveLength(before);
    // the admins are only told about a new review
    expect(mockDb.state.notifications).toHaveLength(0);
  });

  it('refuses a booking that is not paid, not theirs, or does not exist', async () => {
    const unpaid = await request(app).post('/api/reviews').set('Authorization', asCustomer()).send({ bookingId: 2, rating: 4 });
    expect(unpaid.status).toBe(403);
    expect(unpaid.body.message).toMatch(/booked and paid for/i);

    const someoneElses = await request(app).post('/api/reviews').set('Authorization', asOther()).send({ bookingId: 1, rating: 4 });
    expect(someoneElses.status).toBe(403);

    expect((await request(app).post('/api/reviews').set('Authorization', asCustomer()).send({ bookingId: 9999, rating: 4 })).status).toBe(403);
  });

  it('validates the payload and needs a token', async () => {
    expect((await request(app).post('/api/reviews').send({ bookingId: 1, rating: 5 })).status).toBe(401);

    const missing = await request(app).post('/api/reviews').set('Authorization', asCustomer()).send({});
    expect(missing.status).toBe(400);
    expect(missing.body.errors.map(e => e.field)).toEqual(expect.arrayContaining(['bookingId', 'rating']));

    for (const rating of [0, 6, 2.5]) {
      const res = await request(app).post('/api/reviews').set('Authorization', asCustomer()).send({ bookingId: 1, rating });
      expect(res.status).toBe(400);
    }

    const longComment = await request(app).post('/api/reviews').set('Authorization', asCustomer())
      .send({ bookingId: 1, rating: 5, comment: 'x'.repeat(1001) });
    expect(longComment.status).toBe(400);
  });
});

describe('GET /api/reviews/my', () => {
  it('returns only the signed-in customer reviews', async () => {
    const mine = await request(app).get('/api/reviews/my').set('Authorization', asCustomer());
    expect(mine.status).toBe(200);
    expect(mine.body.data).toHaveLength(1);
    expect(mine.body.data[0].user).toBe('2');

    const theirs = await request(app).get('/api/reviews/my').set('Authorization', asOther());
    expect(theirs.body.data).toHaveLength(0);

    expect((await request(app).get('/api/reviews/my')).status).toBe(401);
  });
});

describe('reviews reach the analytics page', () => {
  it('averages the scores into the top-courses table', async () => {
    // a second customer rates the same course
    await request(app).post('/api/reviews').set('Authorization', asOther()).send({ bookingId: 3, rating: 5 });

    const res = await request(app).get('/api/dashboard/analytics').set('Authorization', asAdmin());
    expect(res.status).toBe(200);

    const course = res.body.data.topCourses.find(c => c.courseId === '1');
    // ratings of 3 and 5
    expect(course.rating).toBe(4);
    expect(course.reviewCount).toBe(2);
  });
});
