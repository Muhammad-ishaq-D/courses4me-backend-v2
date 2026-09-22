/**
 * HTTP-level tests for the courses module: public listing and visibility,
 * filters, category stats, and admin create / update / delete including the
 * nested venues, schedules and display lists.
 */
const request = require('supertest');
const { createMockDb, tokenFor } = require('./helpers/mockDb');

const mockDb = createMockDb({
  users: [
    { id: 1, name: 'Site Admin', email: 'admin@courses4me.test', password: 'Adm1n!Pass', role: 'admin' },
    { id: 2, name: 'Cathy Customer', email: 'cathy@example.test', password: 'Cust0mer!Pass', role: 'customer' }
  ],
  courses: [
    { id: 1, title: 'Door Supervisor Course', category: 'SIA Training', status: 'Published', base_price: 199.99, created_at: '2026-01-01T10:00:00Z' },
    { id: 2, title: 'Emergency First Aid at Work', category: 'First Aid', status: 'Published', base_price: 89, created_at: '2026-02-01T10:00:00Z' },
    { id: 3, title: 'Secret Draft Course', category: 'Specialist', status: 'Draft', base_price: 50, created_at: '2026-03-01T10:00:00Z' }
  ]
});

jest.mock('../src/config/db', () => mockDb);
jest.mock('../src/utils/geocodePostcode', () => ({
  // The real helper calls postcodes.io; here the coordinates are fixed.
  enrichLocationsWithCoordinates: jest.fn(async (locations) =>
    locations.map(l => ({ ...l, postcode: String(l.postcode).toUpperCase(), latitude: 51.5, longitude: -0.12 }))
  )
}));
jest.mock('../src/middlewares/uploadMiddleware', () => ({ fields: () => (req, res, next) => next() }));

const { enrichLocationsWithCoordinates } = require('../src/utils/geocodePostcode');
const app = require('../src/app');

const asAdmin = () => `Bearer ${tokenFor(mockDb.findUser('admin@courses4me.test'))}`;
const asCustomer = () => `Bearer ${tokenFor(mockDb.findUser('cathy@example.test'))}`;

const validCourse = {
  title: 'CCTV Operator Training',
  category: 'Specialist',
  duration: '3 Days',
  shortDescription: 'Learn to operate public space surveillance systems safely.',
  fullDescription: 'The full syllabus of the CCTV operator qualification.',
  pricing: { basePrice: 249.5, salePrice: 199 },
  highlights: ['SIA approved', 'Small groups', ''],
  learningPoints: ['Camera operation', 'Evidence handling'],
  requirements: ['18 or over'],
  instructor: { name: 'Jane Trainer', title: 'Lead Instructor' },
  locations: [{
    name: 'London Centre',
    address: '1 Test Street',
    postcode: 'sw1a 1aa',
    schedules: [
      { time: '09:00 - 17:00', startDate: '2026-11-01', endDate: '2026-11-03', price: 249.5, seatsAvailable: 12 },
      { time: '09:00 - 17:00', startDate: '2026-12-01', endDate: '2026-12-03', price: 249.5 }
    ]
  }],
  status: 'Published',
  isPopular: true
};

describe('GET /api/courses', () => {
  it('shows only published courses to the public, newest first', async () => {
    const res = await request(app).get('/api/courses');
    expect(res.status).toBe(200);
    expect(res.body.count).toBe(res.body.data.length);
    expect(res.body.data.map(c => c.title)).toEqual(['Emergency First Aid at Work', 'Door Supervisor Course']);
    expect(res.body.data.every(c => c.status === 'Published')).toBe(true);
  });

  it('shows drafts to an admin and returns the frontend shape', async () => {
    const res = await request(app).get('/api/courses').set('Authorization', asAdmin());
    expect(res.status).toBe(200);
    expect(res.body.data.map(c => c.title)).toContain('Secret Draft Course');

    const course = res.body.data.find(c => c.id === 1);
    expect(course).toMatchObject({ id: 1, _id: '1', title: 'Door Supervisor Course', isPopular: false });
    expect(course.pricing).toEqual({ basePrice: 199.99, salePrice: null, originalPrice: null });
    expect(course.guarantee).toHaveProperty('title');
    expect(Array.isArray(course.highlights)).toBe(true);
    expect(Array.isArray(course.locations)).toBe(true);
    expect(Array.isArray(course.sessions)).toBe(true);
  });

  it('filters by category, status and search', async () => {
    const byCategory = await request(app).get('/api/courses?category=First Aid');
    expect(byCategory.body.data.map(c => c.title)).toEqual(['Emergency First Aid at Work']);

    const bySearch = await request(app).get('/api/courses?search=door');
    expect(bySearch.body.data.map(c => c.title)).toEqual(['Door Supervisor Course']);

    const byStatus = await request(app).get('/api/courses?status=Draft').set('Authorization', asAdmin());
    expect(byStatus.body.data.map(c => c.title)).toEqual(['Secret Draft Course']);

    const bad = await request(app).get('/api/courses?category=Nonsense');
    expect(bad.status).toBe(400);
  });

  it('ignores the page and limit the admin table sends', async () => {
    const res = await request(app).get('/api/courses?page=2&limit=1').set('Authorization', asAdmin());
    expect(res.status).toBe(200);
    expect(res.body.count).toBe(3);
  });
});

describe('GET /api/courses/stats/categories', () => {
  it('counts published courses for the public and everything for an admin', async () => {
    const pub = await request(app).get('/api/courses/stats/categories');
    expect(pub.status).toBe(200);
    expect(pub.body.data).toEqual(expect.arrayContaining([{ _id: 'SIA Training', count: 1 }, { _id: 'First Aid', count: 1 }]));
    expect(pub.body.data.find(s => s._id === 'Specialist')).toBeUndefined();

    const admin = await request(app).get('/api/courses/stats/categories').set('Authorization', asAdmin());
    expect(admin.body.data.find(s => s._id === 'Specialist')).toEqual({ _id: 'Specialist', count: 1 });
  });
});

describe('GET /api/courses/:id', () => {
  it('returns a published course to anyone', async () => {
    const res = await request(app).get('/api/courses/1');
    expect(res.status).toBe(200);
    expect(res.body.data).toMatchObject({ id: 1, _id: '1', title: 'Door Supervisor Course' });
  });

  it('hides a draft from the public but shows it to an admin', async () => {
    const pub = await request(app).get('/api/courses/3');
    expect(pub.status).toBe(403);
    expect(pub.body.message).toMatch(/not available/i);

    const admin = await request(app).get('/api/courses/3').set('Authorization', asAdmin());
    expect(admin.status).toBe(200);
  });

  it('404s for an unknown id and 400s for a malformed one', async () => {
    expect((await request(app).get('/api/courses/9999')).status).toBe(404);
    expect((await request(app).get('/api/courses/not-a-number')).status).toBe(400);
  });
});

describe('POST /api/courses', () => {
  it('requires an admin', async () => {
    expect((await request(app).post('/api/courses').send(validCourse)).status).toBe(401);
    expect((await request(app).post('/api/courses').set('Authorization', asCustomer()).send(validCourse)).status).toBe(403);
  });

  it('rejects a payload missing the mandatory fields', async () => {
    const res = await request(app).post('/api/courses').set('Authorization', asAdmin()).send({ title: 'x' });
    expect(res.status).toBe(400);
    expect(res.body.errors.map(e => e.field)).toEqual(
      expect.arrayContaining(['title', 'category', 'duration', 'shortDescription', 'fullDescription', 'pricing'])
    );
  });

  it('creates the course with its lists, venues, schedules and sessions', async () => {
    const res = await request(app).post('/api/courses').set('Authorization', asAdmin()).send(validCourse);
    expect(res.status).toBe(201);

    const data = res.body.data;
    expect(data).toMatchObject({ title: 'CCTV Operator Training', category: 'Specialist', isPopular: true, status: 'Published' });
    expect(data.pricing).toEqual({ basePrice: 249.5, salePrice: 199, originalPrice: null });
    expect(data.instructor.name).toBe('Jane Trainer');

    // blank list entries are dropped, order is kept
    expect(data.highlights).toEqual(['SIA approved', 'Small groups']);
    expect(data.learningPoints).toEqual(['Camera operation', 'Evidence handling']);
    expect(data.targetAudience).toEqual([]);

    // the postcode was normalised and geocoded
    expect(enrichLocationsWithCoordinates).toHaveBeenCalled();
    expect(data.locations).toHaveLength(1);
    expect(data.locations[0]).toMatchObject({ name: 'London Centre', postcode: 'SW1A 1AA', latitude: 51.5, longitude: -0.12 });
    expect(data.locations[0].schedules).toHaveLength(2);
    expect(data.locations[0].schedules[0]).toMatchObject({ time: '09:00 - 17:00', price: 249.5, seatsAvailable: 12, availabilityStatus: 'Available' });
    expect(data.locations[0].schedules[1].seatsAvailable).toBe(20); // default

    // sessions are the venue schedules flattened
    expect(data.sessions).toHaveLength(2);

    // clients slice a short reference out of _id, so it must be a string
    expect(typeof data._id).toBe('string');
    expect(typeof data.locations[0]._id).toBe('string');
    expect(typeof data.locations[0].schedules[0]._id).toBe('string');
    expect(typeof data.sessions[0]._id).toBe('string');
    expect(data.sessions[0]).toMatchObject({ location: 'London Centre', price: 249.5 });
  });

  it('strips fields a client may not set', async () => {
    const res = await request(app).post('/api/courses').set('Authorization', asAdmin())
      .send({ ...validCourse, title: 'Strip Test', id: 999, legacyId: 'abc', createdAt: '2000-01-01' });
    expect(res.status).toBe(201);
    expect(res.body.data.id).not.toBe(999);
    expect(new Date(res.body.data.createdAt).getFullYear()).toBeGreaterThan(2000);
  });

  it('rejects a venue without a postcode and a schedule that ends before it starts', async () => {
    const noPostcode = { ...validCourse, locations: [{ name: 'X', schedules: [] }] };
    expect((await request(app).post('/api/courses').set('Authorization', asAdmin()).send(noPostcode)).status).toBe(400);

    const badDates = {
      ...validCourse,
      locations: [{ name: 'X', postcode: 'SW1A 1AA', schedules: [{ time: '9-5', startDate: '2026-11-10', endDate: '2026-11-01', price: 10 }] }]
    };
    expect((await request(app).post('/api/courses').set('Authorization', asAdmin()).send(badDates)).status).toBe(400);
  });
});

describe('PUT /api/courses/:id', () => {
  it('updates scalars without touching the lists or venues', async () => {
    const created = await request(app).post('/api/courses').set('Authorization', asAdmin())
      .send({ ...validCourse, title: 'Partial Update Course' });
    const id = created.body.data.id;

    const res = await request(app).put(`/api/courses/${id}`).set('Authorization', asAdmin())
      .send({ status: 'Draft', pricing: { basePrice: 300 } });
    expect(res.status).toBe(200);
    expect(res.body.data.status).toBe('Draft');
    expect(res.body.data.pricing.basePrice).toBe(300);
    expect(res.body.data.pricing.salePrice).toBe(199); // untouched
    expect(res.body.data.highlights).toEqual(['SIA approved', 'Small groups']);
    expect(res.body.data.locations).toHaveLength(1);
  });

  it('replaces the lists and venues when the payload carries them', async () => {
    const created = await request(app).post('/api/courses').set('Authorization', asAdmin())
      .send({ ...validCourse, title: 'Replace Course' });
    const id = created.body.data.id;

    const res = await request(app).put(`/api/courses/${id}`).set('Authorization', asAdmin()).send({
      highlights: ['Only one now'],
      locations: [{ name: 'Manchester Centre', postcode: 'M1 1AE', schedules: [] }]
    });
    expect(res.status).toBe(200);
    expect(res.body.data.highlights).toEqual(['Only one now']);
    expect(res.body.data.learningPoints).toEqual(['Camera operation', 'Evidence handling']); // not sent, kept
    expect(res.body.data.locations).toHaveLength(1);
    expect(res.body.data.locations[0].name).toBe('Manchester Centre');
    expect(res.body.data.sessions).toEqual([]);
  });

  it('404s for an unknown course and refuses non-admins', async () => {
    expect((await request(app).put('/api/courses/9999').set('Authorization', asAdmin()).send({ status: 'Draft' })).status).toBe(404);
    expect((await request(app).put('/api/courses/1').set('Authorization', asCustomer()).send({ status: 'Draft' })).status).toBe(403);
  });
});

describe('DELETE /api/courses/:id', () => {
  it('removes the course and its children, then 404s', async () => {
    const created = await request(app).post('/api/courses').set('Authorization', asAdmin())
      .send({ ...validCourse, title: 'Disposable Course' });
    const id = created.body.data.id;

    const res = await request(app).delete(`/api/courses/${id}`).set('Authorization', asAdmin());
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ success: true, data: {} });

    expect(mockDb.state.courseListItems.some(l => l.course_id === id)).toBe(false);
    expect(mockDb.state.courseVenues.some(v => v.course_id === id)).toBe(false);
    expect((await request(app).delete(`/api/courses/${id}`).set('Authorization', asAdmin())).status).toBe(404);
  });

  it('refuses a customer', async () => {
    expect((await request(app).delete('/api/courses/1').set('Authorization', asCustomer())).status).toBe(403);
  });
});
