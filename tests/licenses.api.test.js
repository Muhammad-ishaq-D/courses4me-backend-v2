/**
 * HTTP-level tests for licences: the public catalogue and visibility rules,
 * admin create / update / delete with the nested lists, steps, fee table,
 * related courses and venues, plus the two places licences reach into other
 * modules — booking a licence session and resolving a licence id on
 * `GET /courses/:id`.
 */
const request = require('supertest');
const { createMockDb, tokenFor } = require('./helpers/mockDb');

const mockDb = createMockDb({
  users: [
    { id: 1, name: 'Site Admin', email: 'admin@courses4me.test', password: 'Adm1n!Pass', role: 'admin' },
    { id: 2, name: 'Cathy Customer', email: 'cathy@example.test', password: 'Cust0mer!Pass', role: 'customer' }
  ],
  courses: [
    { id: 1, title: 'Door Supervisor Course', category: 'SIA Training', status: 'Published' },
    { id: 2, title: 'CCTV Operator Course', category: 'Specialist', status: 'Published' }
  ],
  licenses: [
    { id: 1, title: 'SIA Door Supervisor Licence', license_type: 'Door Supervisor', category: 'SIA Training', status: 'Published', base_price: 220, created_at: '2026-01-01T10:00:00Z' },
    { id: 2, title: 'First Aid at Work Certificate', category: 'First Aid', status: 'Published', base_price: 95, created_at: '2026-02-01T10:00:00Z' },
    { id: 3, title: 'Unpublished Licence', category: 'Specialist', status: 'Draft', base_price: 50, created_at: '2026-03-01T10:00:00Z' },
    { id: 4, title: 'Web Development Licence', category: 'Specialist', status: 'Published', base_price: 400, created_at: '2026-04-01T10:00:00Z' }
  ]
});

jest.mock('../src/config/db', () => mockDb);
jest.mock('../src/utils/sendEmail', () => jest.fn(async () => ({})));
jest.mock('../src/middlewares/uploadMiddleware', () => ({ fields: () => (req, res, next) => next() }));

const app = require('../src/app');

const asAdmin = () => `Bearer ${tokenFor(mockDb.findUser('admin@courses4me.test'))}`;
const asCustomer = () => `Bearer ${tokenFor(mockDb.findUser('cathy@example.test'))}`;

const newLicense = {
  title: 'SIA CCTV Operator Licence',
  licenseType: 'CCTV Operator',
  category: 'Specialist',
  subtitle: 'Public space surveillance',
  shortDescription: 'The licence required to operate CCTV in a public space.',
  fullDescription: 'Everything the licence covers, how to apply and how to renew.',
  salary: '£24,000 - £30,000',
  duration: '3 Days',
  valid: '3 Years',
  pricing: { basePrice: 249.5, salePrice: 199 },
  highlights: ['SIA approved', 'Exam included', ''],
  learningPoints: ['Camera operation', 'Evidence handling'],
  requirements: ['18 or over'],
  applicationSteps: [
    { title: 'Complete the training', desc: 'Attend the three-day course' },
    { title: 'Apply to the SIA', desc: 'Submit your application online' }
  ],
  pricingBreakdown: [
    { label: 'Course fee', price: '£249.50' },
    { label: 'SIA application', price: '£184' }
  ],
  renewalInfo: 'Renew within three months of expiry.',
  instructor: { name: 'Jane Trainer', title: 'Lead Instructor' },
  relatedCourses: [2],
  locations: [{
    name: 'London Centre',
    schedules: [
      { time: '09:00 - 17:00', startDate: '2027-03-01', endDate: '2027-03-03', price: 249.5, seatsAvailable: 6 },
      { startDate: '2027-04-05', endDate: '2027-04-07', price: 249.5 }
    ]
  }],
  status: 'Published',
  isPopular: true
};

describe('GET /api/licenses', () => {
  it('shows only published licences to the public, newest first, with the page block', async () => {
    const res = await request(app).get('/api/licenses');
    expect(res.status).toBe(200);
    expect(res.body.data.every(l => l.status === 'Published')).toBe(true);
    expect(res.body.data.map(l => l.title)).toEqual([
      'Web Development Licence', 'First Aid at Work Certificate', 'SIA Door Supervisor Licence'
    ]);
    // the same list is returned under both keys the apps read
    expect(res.body.licenses).toEqual(res.body.data);
    expect(res.body).toMatchObject({ total: 3, page: 1, limit: 10, count: 3 });
  });

  it('shows drafts to an admin and paginates', async () => {
    const admin = await request(app).get('/api/licenses').set('Authorization', asAdmin());
    expect(admin.body.data.map(l => l.title)).toContain('Unpublished Licence');
    expect(admin.body.total).toBe(4);

    const paged = await request(app).get('/api/licenses?page=2&limit=2').set('Authorization', asAdmin());
    expect(paged.body.data).toHaveLength(2);
    expect(paged.body).toMatchObject({ page: 2, limit: 2, total: 4 });
  });

  it('filters by category, status and search', async () => {
    const byCategory = await request(app).get('/api/licenses?category=First Aid');
    expect(byCategory.body.data.map(l => l.title)).toEqual(['First Aid at Work Certificate']);

    const bySearch = await request(app).get('/api/licenses?search=door');
    expect(bySearch.body.data.map(l => l.title)).toEqual(['SIA Door Supervisor Licence']);

    const byStatus = await request(app).get('/api/licenses?status=Draft').set('Authorization', asAdmin());
    expect(byStatus.body.data.map(l => l.title)).toEqual(['Unpublished Licence']);

    expect((await request(app).get('/api/licenses?category=Nonsense')).status).toBe(400);
  });
});

describe('GET /api/licenses/:id', () => {
  it('returns a published licence, both nested and spread at the top level', async () => {
    const res = await request(app).get('/api/licenses/1');
    expect(res.status).toBe(200);
    expect(res.body.data).toMatchObject({ id: 1, _id: '1', title: 'SIA Door Supervisor Licence' });
    // callers that read the licence straight off the body still work
    expect(res.body.title).toBe('SIA Door Supervisor Licence');
    expect(res.body.licenseType).toBe('Door Supervisor');
  });

  it('hides a draft from the public but shows it to an admin', async () => {
    const pub = await request(app).get('/api/licenses/3');
    expect(pub.status).toBe(403);
    expect(pub.body.message).toMatch(/not available/i);

    expect((await request(app).get('/api/licenses/3').set('Authorization', asAdmin())).status).toBe(200);
  });

  it('404s for an unknown id and 400s for a malformed one', async () => {
    expect((await request(app).get('/api/licenses/9999')).status).toBe(404);
    expect((await request(app).get('/api/licenses/not-a-number')).status).toBe(400);
  });
});

describe('POST /api/licenses', () => {
  it('requires an admin and a complete payload', async () => {
    expect((await request(app).post('/api/licenses').send(newLicense)).status).toBe(401);
    expect((await request(app).post('/api/licenses').set('Authorization', asCustomer()).send(newLicense)).status).toBe(403);

    const invalid = await request(app).post('/api/licenses').set('Authorization', asAdmin()).send({ title: 'x' });
    expect(invalid.status).toBe(400);
    expect(invalid.body.errors.map(e => e.field)).toEqual(
      expect.arrayContaining(['title', 'category', 'shortDescription', 'fullDescription', 'pricing'])
    );
  });

  it('creates the licence with every nested block and issues the credential', async () => {
    const res = await request(app).post('/api/licenses').set('Authorization', asAdmin()).send(newLicense);
    expect(res.status).toBe(201);

    const data = res.body.data;
    expect(data).toMatchObject({ title: 'SIA CCTV Operator Licence', licenseType: 'CCTV Operator', isPopular: true, status: 'Published' });
    expect(data.pricing).toEqual({ basePrice: 249.5, salePrice: 199, originalPrice: null });

    // blank list entries are dropped, order is kept
    expect(data.highlights).toEqual(['SIA approved', 'Exam included']);
    expect(data.learningPoints).toEqual(['Camera operation', 'Evidence handling']);
    expect(data.applicationSteps.map(s => s.title)).toEqual(['Complete the training', 'Apply to the SIA']);
    expect(data.pricingBreakdown[1]).toMatchObject({ label: 'SIA application', price: '£184' });

    // the holder name defaults to the licence title, with generated credentials
    expect(data.holderName).toBe('SIA CCTV Operator Licence');
    expect(data.licenseNumber).toMatch(/^SIA-\d{8}$/);
    expect(data.holderId).toMatch(/^LH-\d{3}$/);
    expect(data.expiryDate).toBeTruthy();
    expect(data.licenseAuthority).toMatch(/SIA/);

    // defaults from the schema
    expect(data.experience).toBe('5 Years');
    expect(data.icon).toBe('shield');

    // related courses and venues
    expect(data.relatedCourses).toEqual(['2']);
    expect(data.locations).toHaveLength(1);
    expect(data.locations[0].schedules).toHaveLength(2);
    expect(data.locations[0].schedules[0]).toMatchObject({ time: '09:00 - 17:00', seatsAvailable: 6, availabilityStatus: 'Available' });
    // the schema defaults fill the second session in
    expect(data.locations[0].schedules[1]).toMatchObject({ time: '09:00 - 17:00', seatsAvailable: 20 });
    expect(typeof data.locations[0].schedules[0]._id).toBe('string');
  });

  it('ignores a related course that does not exist', async () => {
    const res = await request(app).post('/api/licenses').set('Authorization', asAdmin())
      .send({ ...newLicense, title: 'Orphan Links Licence', relatedCourses: [1, 9999] });
    expect(res.status).toBe(201);
    expect(res.body.data.relatedCourses).toEqual(['1']);
  });

  it('rejects a session that ends before it starts', async () => {
    const res = await request(app).post('/api/licenses').set('Authorization', asAdmin()).send({
      ...newLicense,
      title: 'Bad Dates Licence',
      locations: [{ name: 'X', schedules: [{ startDate: '2027-05-10', endDate: '2027-05-01', price: 10 }] }]
    });
    expect(res.status).toBe(400);
  });
});

describe('PUT /api/licenses/:id', () => {
  let licenseId;

  beforeAll(async () => {
    const created = await request(app).post('/api/licenses').set('Authorization', asAdmin())
      .send({ ...newLicense, title: 'Editable Licence' });
    licenseId = created.body.data.id;
  });

  it('updates scalars without touching the nested blocks', async () => {
    const res = await request(app).put(`/api/licenses/${licenseId}`).set('Authorization', asAdmin())
      .send({ status: 'Draft', pricing: { basePrice: 300 }, renewalInfo: 'Renew annually.' });
    expect(res.status).toBe(200);
    expect(res.body.data).toMatchObject({ status: 'Draft', renewalInfo: 'Renew annually.' });
    expect(res.body.data.pricing).toMatchObject({ basePrice: 300, salePrice: 199 });
    expect(res.body.data.highlights).toEqual(['SIA approved', 'Exam included']);
    expect(res.body.data.applicationSteps).toHaveLength(2);
    expect(res.body.data.locations).toHaveLength(1);
  });

  it('replaces a block when the payload carries it', async () => {
    const res = await request(app).put(`/api/licenses/${licenseId}`).set('Authorization', asAdmin()).send({
      highlights: ['Only one now'],
      applicationSteps: [{ title: 'Single step', desc: 'Do it' }],
      relatedCourses: [1],
      locations: [{ name: 'Manchester Centre', schedules: [] }]
    });
    expect(res.status).toBe(200);
    expect(res.body.data.highlights).toEqual(['Only one now']);
    expect(res.body.data.learningPoints).toEqual(['Camera operation', 'Evidence handling']); // not sent, kept
    expect(res.body.data.applicationSteps).toHaveLength(1);
    expect(res.body.data.relatedCourses).toEqual(['1']);
    expect(res.body.data.locations[0].name).toBe('Manchester Centre');
    expect(res.body.data.locations[0].schedules).toEqual([]);
  });

  it('404s for an unknown licence and refuses non-admins', async () => {
    expect((await request(app).put('/api/licenses/9999').set('Authorization', asAdmin()).send({ status: 'Draft' })).status).toBe(404);
    expect((await request(app).put(`/api/licenses/${licenseId}`).set('Authorization', asCustomer()).send({ status: 'Draft' })).status).toBe(403);
  });
});

describe('DELETE /api/licenses/:id', () => {
  it('removes the licence with its children, then 404s', async () => {
    const created = await request(app).post('/api/licenses').set('Authorization', asAdmin())
      .send({ ...newLicense, title: 'Disposable Licence' });
    const id = created.body.data.id;

    const res = await request(app).delete(`/api/licenses/${id}`).set('Authorization', asAdmin());
    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({ success: true, message: 'License deleted successfully', data: {} });

    expect(mockDb.state.licenseListItems.some(x => x.license_id === id)).toBe(false);
    expect(mockDb.state.licenseVenues.some(v => v.license_id === id)).toBe(false);
    expect((await request(app).delete(`/api/licenses/${id}`).set('Authorization', asAdmin())).status).toBe(404);
  });

  it('refuses a customer', async () => {
    expect((await request(app).delete('/api/licenses/1').set('Authorization', asCustomer())).status).toBe(403);
  });
});

describe('licences reach into the other modules', () => {
  it('resolves a licence id on GET /courses/:id to the course that teaches it', async () => {
    // "SIA Door Supervisor Licence" matches the door supervisor course by keyword
    const mapped = await request(app).get('/api/courses/1');
    expect(mapped.status).toBe(200);

    // a licence with no matching course comes back as the licence itself
    const standalone = await request(app).get('/api/courses/4');
    expect(standalone.status).toBe(200);
    expect(standalone.body.data.title).toBe('Web Development Licence');
  });

  it('books a seat on a licence session', async () => {
    const created = await request(app).post('/api/licenses').set('Authorization', asAdmin())
      .send({ ...newLicense, title: 'Bookable Licence' });
    const licenseId = created.body.data.id;
    const schedule = created.body.data.locations[0].schedules[0];
    const seatsBefore = schedule.seatsAvailable;

    const booking = await request(app).post('/api/bookings').send({
      courseId: licenseId,
      session: { scheduleId: schedule.id },
      customerDetails: { firstName: 'Lic', lastName: 'Holder', email: 'lic.holder@example.test', phone: '07000000002' },
      billingAddress: { postcode: 'SW1A 1AA', line1: '1 Test Street', city: 'London' },
      totalAmount: 249.5
    });

    expect(booking.status).toBe(201);
    expect(booking.body.data.courseModel).toBe('License');
    expect(booking.body.data.session).toMatchObject({ scheduleSource: 'license_venue_schedule', locationName: 'London Centre' });
    expect(booking.body.data.course).toMatchObject({ title: 'Bookable Licence' });

    // the seat came off the licence session
    const after = await request(app).get(`/api/licenses/${licenseId}`).set('Authorization', asAdmin());
    expect(after.body.data.locations[0].schedules[0].seatsAvailable).toBe(seatsBefore - 1);
  });
});
