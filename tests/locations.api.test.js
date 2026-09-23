/**
 * HTTP-level tests for locations and the course scheduling system: venue
 * management, linking a location to a course with its price and dates, seat
 * availability, weekday timings, and the sessions those dates add to a course.
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
    { id: 2, title: 'Secret Draft Course', category: 'Specialist', status: 'Draft' }
  ],
  locations: [
    { id: 1, name: 'London Centre', city: 'London', postcode: 'SW1A 1AA', status: 'Active', facilities: ['wifi', 'toilets'], gallery: ['a.jpg', 'b.jpg'], created_at: '2026-01-01T10:00:00Z' },
    { id: 2, name: 'Manchester Centre', city: 'Manchester', postcode: 'M1 1AE', status: 'Active', created_at: '2026-02-01T10:00:00Z' },
    { id: 3, name: 'Closed Centre', city: 'Leeds', postcode: 'LS1 1UR', status: 'Inactive', created_at: '2026-03-01T10:00:00Z' },
    { id: 4, name: 'Bristol Centre', city: 'Bristol', postcode: 'BS1 4DJ', status: 'Active', created_at: '2026-04-01T10:00:00Z' }
  ],
  courseLocations: [
    { id: 1, course_id: 1, location_id: 1, price: 225.5, status: 'Active', dates: [{ available_seats: 20, booked_seats: 3 }] },
    { id: 2, course_id: 2, location_id: 2, price: 150, status: 'Active' },
    { id: 3, course_id: 1, location_id: 3, price: 199, status: 'Inactive' }
  ]
});

jest.mock('../src/config/db', () => mockDb);
jest.mock('../src/middlewares/uploadMiddleware', () => ({ fields: () => (req, res, next) => next() }));

const app = require('../src/app');

const asAdmin = () => `Bearer ${tokenFor(mockDb.findUser('admin@courses4me.test'))}`;
const asCustomer = () => `Bearer ${tokenFor(mockDb.findUser('cathy@example.test'))}`;

const newLocation = {
  name: 'Birmingham Centre',
  venueName: 'Bull Ring Training Rooms',
  addressLine1: '10 High Street',
  city: 'Birmingham',
  postcode: 'b1 1aa',
  parking: true,
  parkingNotes: 'Multi-storey next door',
  facilities: ['wifi', 'projector', 'catering'],
  gallery: ['one.jpg', 'two.jpg', ''],
  status: 'Active'
};

describe('GET /api/locations', () => {
  it('returns a page of locations with facilities, gallery and linked-course counts', async () => {
    const res = await request(app).get('/api/locations');
    expect(res.status).toBe(200);
    expect(res.body.pagination).toEqual({ total: 4, page: 1, limit: 20, pages: 1 });

    const london = res.body.data.find(l => l.id === 1);
    expect(london).toMatchObject({ _id: '1', name: 'London Centre', postcode: 'SW1A 1AA', parking: false, status: 'Active' });
    expect(london.facilities).toEqual(['toilets', 'wifi']);
    expect(london.gallery).toEqual(['a.jpg', 'b.jpg']);
    // only Active links to Published courses are counted
    expect(london.linkedCoursesCount).toBe(1);
    expect(res.body.data.find(l => l.id === 2).linkedCoursesCount).toBe(0); // course is a draft
  });

  it('paginates and filters by search and status', async () => {
    const paged = await request(app).get('/api/locations?page=2&limit=2');
    expect(paged.body.data).toHaveLength(2);
    expect(paged.body.pagination).toMatchObject({ page: 2, limit: 2, pages: 2 });

    const search = await request(app).get('/api/locations?search=manchester');
    expect(search.body.data.map(l => l.name)).toEqual(['Manchester Centre']);

    const byPostcode = await request(app).get('/api/locations?search=LS1');
    expect(byPostcode.body.data.map(l => l.name)).toEqual(['Closed Centre']);

    const inactive = await request(app).get('/api/locations?status=Inactive');
    expect(inactive.body.data.map(l => l.name)).toEqual(['Closed Centre']);

    expect((await request(app).get('/api/locations?status=Nope')).status).toBe(400);
  });
});

describe('GET /api/locations/:id', () => {
  it('returns the location and counts every link regardless of status', async () => {
    const res = await request(app).get('/api/locations/3');
    expect(res.status).toBe(200);
    expect(res.body.data).toMatchObject({ id: 3, name: 'Closed Centre', status: 'Inactive' });
    expect(res.body.data.linkedCoursesCount).toBe(1); // the inactive link still counts here
  });

  it('404s for an unknown id and 400s for a malformed one', async () => {
    expect((await request(app).get('/api/locations/999')).status).toBe(404);
    expect((await request(app).get('/api/locations/abc')).status).toBe(400);
  });
});

describe('location writes', () => {
  it('requires an admin', async () => {
    expect((await request(app).post('/api/locations').send(newLocation)).status).toBe(401);
    expect((await request(app).post('/api/locations').set('Authorization', asCustomer()).send(newLocation)).status).toBe(403);
  });

  it('creates a location, upper-casing the postcode and storing the lists', async () => {
    const res = await request(app).post('/api/locations').set('Authorization', asAdmin()).send(newLocation);
    expect(res.status).toBe(201);
    expect(res.body.data).toMatchObject({
      name: 'Birmingham Centre', postcode: 'B1 1AA', city: 'Birmingham', parking: true, country: 'United Kingdom'
    });
    expect(res.body.data.facilities).toEqual(['catering', 'projector', 'wifi']);
    expect(res.body.data.gallery).toEqual(['one.jpg', 'two.jpg']); // the blank entry is dropped
    expect(typeof res.body.data._id).toBe('string');
  });

  it('rejects a payload missing the required fields or with an unknown facility', async () => {
    const missing = await request(app).post('/api/locations').set('Authorization', asAdmin()).send({ name: 'X' });
    expect(missing.status).toBe(400);
    expect(missing.body.errors.map(e => e.field)).toEqual(expect.arrayContaining(['addressLine1', 'city', 'postcode']));

    const badFacility = await request(app).post('/api/locations').set('Authorization', asAdmin())
      .send({ ...newLocation, facilities: ['helipad'] });
    expect(badFacility.status).toBe(400);
  });

  it('updates scalars without clearing the lists, and replaces a list when sent', async () => {
    const partial = await request(app).put('/api/locations/1').set('Authorization', asAdmin()).send({ city: 'Westminster' });
    expect(partial.status).toBe(200);
    expect(partial.body.data.city).toBe('Westminster');
    expect(partial.body.data.facilities).toEqual(['toilets', 'wifi']);

    const replaced = await request(app).put('/api/locations/1').set('Authorization', asAdmin()).send({ facilities: ['catering'] });
    expect(replaced.body.data.facilities).toEqual(['catering']);
    expect(replaced.body.data.gallery).toEqual(['a.jpg', 'b.jpg']);

    expect((await request(app).put('/api/locations/999').set('Authorization', asAdmin()).send({ city: 'Xtown' })).status).toBe(404);
  });

  it('flips the status when none is given and sets it when one is', async () => {
    const flipped = await request(app).patch('/api/locations/2/status').set('Authorization', asAdmin()).send({});
    expect(flipped.body.data.status).toBe('Inactive');

    const set = await request(app).patch('/api/locations/2/status').set('Authorization', asAdmin()).send({ status: 'Active' });
    expect(set.body.data.status).toBe('Active');

    expect((await request(app).patch('/api/locations/2/status').set('Authorization', asAdmin()).send({ status: 'Deleted' })).status).toBe(400);
  });
});

describe('GET /api/locations/:id/courses', () => {
  it('lists the links of a location with a course summary', async () => {
    const res = await request(app).get('/api/locations/1/courses');
    expect(res.status).toBe(200);
    expect(res.body.data).toHaveLength(1);
    expect(res.body.data[0]).toMatchObject({ _id: '1', price: 225.5, status: 'Active', locationId: '1' });
    expect(res.body.data[0].courseId).toMatchObject({ _id: '1', title: 'Door Supervisor Course', category: 'SIA Training', status: 'Published' });
  });
});

describe('GET /api/course-locations', () => {
  it('returns only active links of published courses, with location, course and dates', async () => {
    const res = await request(app).get('/api/course-locations');
    expect(res.status).toBe(200);
    expect(res.body.data.map(l => l._id)).toEqual(['1']); // link 2 is a draft course, link 3 is inactive

    const link = res.body.data[0];
    expect(link.locationId).toMatchObject({ _id: '1', name: 'London Centre', status: 'Active' });
    expect(link.courseId).toMatchObject({ _id: '1', title: 'Door Supervisor Course' });
    expect(link.courseId.pricing).toHaveProperty('basePrice');
    // seats are reported as availability: 20 - 3 booked
    expect(link.dates[0]).toMatchObject({ availableSeats: 17, bookedSeats: 0 });
  });
});

describe('GET /api/course-locations/course/:courseId', () => {
  it('returns every link by default and only bookable ones with activeOnly', async () => {
    const all = await request(app).get('/api/course-locations/course/1');
    expect(all.body.data.map(l => l._id).sort()).toEqual(['1', '3']);

    const active = await request(app).get('/api/course-locations/course/1?activeOnly=true');
    expect(active.body.data.map(l => l._id)).toEqual(['1']); // link 3 is inactive and its location is disabled
  });
});

describe('POST /api/course-locations/course/:courseId', () => {
  it('links a location with its price and dates, including weekday timings', async () => {
    const res = await request(app).post('/api/course-locations/course/1').set('Authorization', asAdmin()).send({
      locationId: 2,
      price: 199.99,
      vatIncluded: true,
      depositRequired: true,
      depositAmount: 50,
      whatsIncluded: 'Manuals and exam fee',
      dates: [
        { startDate: '2026-11-02', endDate: '2026-11-05', startTime: '09:00', endTime: '17:00', availableSeats: 12 },
        {
          startDate: '2026-12-01', endDate: '2026-12-04', availableSeats: 8, timingsType: 'flexible',
          weeklyTimings: {
            monday: { isOff: false, startTime: '09:30', endTime: '16:30' },
            saturday: { isOff: true, startTime: '', endTime: '' }
          }
        }
      ]
    });
    expect(res.status).toBe(201);

    const link = res.body.data;
    expect(link).toMatchObject({ price: 199.99, vatIncluded: true, depositRequired: true, depositAmount: 50, status: 'Active' });
    expect(link.locationId).toMatchObject({ _id: '2', name: 'Manchester Centre' });
    expect(link.dates).toHaveLength(2);
    expect(link.dates[0]).toMatchObject({ startDate: '2026-11-02', startTime: '09:00', endTime: '17:00', availableSeats: 12, timingsType: 'same' });
    // defaults apply when no times are sent
    expect(link.dates[1]).toMatchObject({ startTime: '09:00', endTime: '17:00', timingsType: 'flexible' });
    expect(link.dates[1].weeklyTimings.monday).toEqual({ isOff: false, startTime: '09:30', endTime: '16:30' });
    expect(link.dates[1].weeklyTimings.saturday).toEqual({ isOff: true, startTime: null, endTime: null });
  });

  it('refuses a second link to the same location, a disabled location and an unknown one', async () => {
    const duplicate = await request(app).post('/api/course-locations/course/1').set('Authorization', asAdmin())
      .send({ locationId: 1, price: 100 });
    expect(duplicate.status).toBe(400);
    expect(duplicate.body.message).toMatch(/already linked/i);

    const disabled = await request(app).post('/api/course-locations/course/2').set('Authorization', asAdmin())
      .send({ locationId: 3, price: 100 });
    expect(disabled.status).toBe(400);
    expect(disabled.body.message).toMatch(/inactive location/i);

    const unknown = await request(app).post('/api/course-locations/course/1').set('Authorization', asAdmin())
      .send({ locationId: 999, price: 100 });
    expect(unknown.status).toBe(404);
  });

  it('validates the payload and the role', async () => {
    expect((await request(app).post('/api/course-locations/course/1').set('Authorization', asCustomer()).send({ locationId: 2, price: 1 })).status).toBe(403);

    const noPrice = await request(app).post('/api/course-locations/course/1').set('Authorization', asAdmin()).send({ locationId: 2 });
    expect(noPrice.status).toBe(400);

    const badDate = await request(app).post('/api/course-locations/course/1').set('Authorization', asAdmin())
      .send({ locationId: 2, price: 10, dates: [{ startDate: '2026-11-10', endDate: '2026-11-01', availableSeats: 5 }] });
    expect(badDate.status).toBe(400);

    const badTime = await request(app).post('/api/course-locations/course/1').set('Authorization', asAdmin())
      .send({ locationId: 2, price: 10, dates: [{ startDate: '2026-11-01', endDate: '2026-11-02', availableSeats: 5, startTime: '9am' }] });
    expect(badTime.status).toBe(400);
  });
});

describe('PUT /api/course-locations/:id', () => {
  it('treats the dates array as the full set: keeps, updates, adds and removes', async () => {
    const created = await request(app).post('/api/course-locations/course/2').set('Authorization', asAdmin()).send({
      locationId: 1,
      price: 120,
      dates: [
        { startDate: '2026-11-01', endDate: '2026-11-02', availableSeats: 10 },
        { startDate: '2026-11-08', endDate: '2026-11-09', availableSeats: 10 }
      ]
    });
    const linkId = created.body.data.id;
    const keep = created.body.data.dates[0];

    const res = await request(app).put(`/api/course-locations/${linkId}`).set('Authorization', asAdmin()).send({
      price: 140,
      status: 'Inactive',
      dates: [
        { _id: keep._id, startDate: keep.startDate, endDate: keep.endDate, availableSeats: 25 },
        { startDate: '2026-12-20', endDate: '2026-12-21', availableSeats: 5 }
      ]
    });
    expect(res.status).toBe(200);
    expect(res.body.data).toMatchObject({ price: 140, status: 'Inactive' });
    expect(res.body.data.dates).toHaveLength(2);
    expect(res.body.data.dates.find(d => d._id === keep._id).availableSeats).toBe(25);
    expect(res.body.data.dates.some(d => d.startDate === '2026-12-20')).toBe(true);
    expect(res.body.data.dates.some(d => d.startDate === '2026-11-08')).toBe(false); // removed
  });

  it('leaves the dates alone when the payload omits them, and 404s for an unknown link', async () => {
    const before = await request(app).get('/api/course-locations/1');
    const res = await request(app).put('/api/course-locations/1').set('Authorization', asAdmin()).send({ whatsIncluded: 'Tea and coffee' });
    expect(res.body.data.whatsIncluded).toBe('Tea and coffee');
    expect(res.body.data.dates).toHaveLength(before.body.data.dates.length);

    expect((await request(app).put('/api/course-locations/999').set('Authorization', asAdmin()).send({ price: 1 })).status).toBe(404);
  });
});

describe('dates', () => {
  it('adds a date to a link and reports seats left with a status label', async () => {
    const res = await request(app).post('/api/course-locations/1/dates').set('Authorization', asAdmin())
      .send({ startDate: '2027-01-10', endDate: '2027-01-12', availableSeats: 4 });
    expect(res.status).toBe(201);
    expect(res.body.data).toMatchObject({ availableSeats: 4, bookedSeats: 0, seatsRemaining: 4, availabilityStatus: 'Selling Fast' });

    expect((await request(app).post('/api/course-locations/999/dates').set('Authorization', asAdmin()).send({ startDate: '2027-01-10', endDate: '2027-01-12', availableSeats: 4 })).status).toBe(404);
  });

  it('updates and deletes a date', async () => {
    const added = await request(app).post('/api/course-locations/1/dates').set('Authorization', asAdmin())
      .send({ startDate: '2027-02-01', endDate: '2027-02-02', availableSeats: 30 });
    const dateId = added.body.data.id;

    const updated = await request(app).put(`/api/course-location-dates/${dateId}`).set('Authorization', asAdmin())
      .send({ availableSeats: 0, startTime: '10:00' });
    expect(updated.status).toBe(200);
    expect(updated.body.data).toMatchObject({ availableSeats: 0, startTime: '10:00', availabilityStatus: 'Sold Out' });

    const removed = await request(app).delete(`/api/course-location-dates/${dateId}`).set('Authorization', asAdmin());
    expect(removed.body).toEqual({ success: true, message: 'Date removed' });
    expect((await request(app).put(`/api/course-location-dates/${dateId}`).set('Authorization', asAdmin()).send({ availableSeats: 1 })).status).toBe(404);
  });

  it('requires an admin for every date write', async () => {
    expect((await request(app).post('/api/course-locations/1/dates').set('Authorization', asCustomer()).send({ startDate: '2027-01-01', endDate: '2027-01-02', availableSeats: 1 })).status).toBe(403);
    expect((await request(app).put('/api/course-location-dates/1').set('Authorization', asCustomer()).send({ availableSeats: 1 })).status).toBe(403);
    expect((await request(app).delete('/api/course-location-dates/1').set('Authorization', asCustomer())).status).toBe(403);
  });
});

describe('DELETE /api/course-locations/:id', () => {
  it('removes the link with its dates', async () => {
    const created = await request(app).post('/api/course-locations/course/2').set('Authorization', asAdmin())
      .send({ locationId: 4, price: 50, dates: [{ startDate: '2026-11-01', endDate: '2026-11-02', availableSeats: 5 }] });
    const linkId = created.body.data.id;

    const res = await request(app).delete(`/api/course-locations/${linkId}`).set('Authorization', asAdmin());
    expect(res.body).toEqual({ success: true, message: 'Location removed from course' });
    expect(mockDb.state.courseLocationDates.some(d => d.course_location_id === linkId)).toBe(false);
    expect((await request(app).get(`/api/course-locations/${linkId}`)).status).toBe(404);
  });
});

describe('scheduled dates appear as course sessions', () => {
  it('adds the scheduling dates to the sessions of a course listing', async () => {
    const res = await request(app).get('/api/courses');
    const course = res.body.data.find(c => c.id === 1);
    expect(course.sessions.length).toBeGreaterThan(0);
    const session = course.sessions[0];
    expect(session).toHaveProperty('availabilityStatus');
    expect(typeof session._id).toBe('string');
  });
});
