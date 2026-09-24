/**
 * HTTP-level tests for the jobs board: vacancy management, the public
 * listing, applying (as a guest, as a signed-in candidate and with an account
 * created on the way), the duplicate guard, the candidate's own applications
 * and the admin review queue.
 */
const request = require('supertest');
const { createMockDb, tokenFor, flushPromises } = require('./helpers/mockDb');

const mockDb = createMockDb({
  users: [
    { id: 1, name: 'Site Admin', email: 'admin@courses4me.test', password: 'Adm1n!Pass', role: 'admin' },
    { id: 2, name: 'Cathy Candidate', email: 'cathy@example.test', password: 'Cust0mer!Pass', role: 'customer' }
  ],
  jobListings: [
    { id: 1, title: 'Door Supervisor', company: 'Courses4Me', location: 'London', category: 'Door Supervisor', type: 'Full-time', status: 'Active', requirements: ['SIA licence', '18 or over'], created_at: '2026-01-01T10:00:00Z' },
    { id: 2, title: 'CCTV Operator', company: 'SecureCo', location: 'Manchester', category: 'CCTV Operator', type: 'Part-time', status: 'Paused', created_at: '2026-02-01T10:00:00Z' },
    { id: 3, title: 'Event Steward', company: 'Courses4Me', location: 'Leeds', category: 'Event Security', type: 'Contract', status: 'Closed', created_at: '2026-03-01T10:00:00Z' }
  ]
});

jest.mock('../src/config/db', () => mockDb);
jest.mock('../src/utils/sendEmail', () => jest.fn(async () => ({})));
jest.mock('../src/middlewares/uploadMiddleware', () => ({ fields: () => (req, res, next) => next() }));

const sendEmail = require('../src/utils/sendEmail');
const app = require('../src/app');

const asAdmin = () => `Bearer ${tokenFor(mockDb.findUser('admin@courses4me.test'))}`;
const asCandidate = () => `Bearer ${tokenFor(mockDb.findUser('cathy@example.test'))}`;
const subjects = () => sendEmail.mock.calls.map(([m]) => m.subject);

const application = (overrides = {}) => ({
  firstName: 'Alex',
  lastName: 'Applicant',
  email: 'alex.applicant@example.test',
  phone: '07000000004',
  address: '12 Test Road',
  city: 'London',
  postcode: 'SW1A 1AA',
  license: 'SIA Licensed',
  experience: '2 years',
  availability: 'Immediately',
  cover: 'I would like to join the team because…',
  ...overrides
});

describe('GET /api/jobs', () => {
  it('lists every vacancy, newest first, whatever its status', async () => {
    const res = await request(app).get('/api/jobs');
    expect(res.status).toBe(200);
    // paused and closed roles stay visible so the board can badge them
    expect(res.body.listings.map(l => l.title)).toEqual(['Event Steward', 'CCTV Operator', 'Door Supervisor']);
    expect(res.body.count).toBe(3);
    // the same list under the key the other service reads
    expect(res.body.data.listings).toEqual(res.body.listings);

    const withRequirements = res.body.listings.find(l => l.id === 1);
    expect(withRequirements.requirements).toEqual(['SIA licence', '18 or over']);
    expect(typeof withRequirements._id).toBe('string');
  });

  it('filters by category, type, status and search', async () => {
    expect((await request(app).get('/api/jobs?category=CCTV Operator')).body.listings.map(l => l.title)).toEqual(['CCTV Operator']);
    expect((await request(app).get('/api/jobs?type=Contract')).body.listings.map(l => l.title)).toEqual(['Event Steward']);
    expect((await request(app).get('/api/jobs?status=Active')).body.listings.map(l => l.title)).toEqual(['Door Supervisor']);
    expect((await request(app).get('/api/jobs?search=secureco')).body.listings.map(l => l.title)).toEqual(['CCTV Operator']);
    expect((await request(app).get('/api/jobs?type=Freelance')).status).toBe(400);
  });
});

describe('GET /api/jobs/:id', () => {
  it('returns the vacancy under both keys', async () => {
    const res = await request(app).get('/api/jobs/1');
    expect(res.status).toBe(200);
    expect(res.body.data).toMatchObject({ id: 1, title: 'Door Supervisor', company: 'Courses4Me' });
    expect(res.body.listing).toEqual(res.body.data);
  });

  it('404s for an unknown id and 400s for a malformed one', async () => {
    expect((await request(app).get('/api/jobs/9999')).status).toBe(404);
    expect((await request(app).get('/api/jobs/not-a-number')).status).toBe(400);
  });
});

describe('vacancy management', () => {
  let listingId;

  it('requires an admin and a complete payload', async () => {
    const payload = { title: 'Security Manager', company: 'Courses4Me', location: 'Bristol', category: 'Security Manager', salary: '£38,000', description: 'Lead the security team.' };
    expect((await request(app).post('/api/jobs').send(payload)).status).toBe(401);
    expect((await request(app).post('/api/jobs').set('Authorization', asCandidate()).send(payload)).status).toBe(403);

    const invalid = await request(app).post('/api/jobs').set('Authorization', asAdmin()).send({ title: 'x' });
    expect(invalid.status).toBe(400);
    expect(invalid.body.errors.map(e => e.field)).toEqual(
      expect.arrayContaining(['title', 'company', 'location', 'category', 'salary', 'description'])
    );
  });

  it('creates a vacancy, accepting the requirements as a list or one line', async () => {
    const res = await request(app).post('/api/jobs').set('Authorization', asAdmin()).send({
      title: 'Close Protection Officer',
      company: 'Courses4Me',
      location: 'London',
      category: 'Close Protection',
      career: 'Close Protection',
      type: 'Contract',
      salary: '£200 per day',
      description: 'Protect clients at events and in transit.',
      requirements: ['CP licence', 'Clean driving licence', ''],
      isFeatured: true
    });
    expect(res.status).toBe(201);
    listingId = res.body.data.id;
    expect(res.body.data).toMatchObject({ title: 'Close Protection Officer', type: 'Contract', isFeatured: true, status: 'Active' });
    expect(res.body.data.requirements).toEqual(['CP licence', 'Clean driving licence']);
    expect(res.body.listing).toEqual(res.body.data);

    // the admin form may send one comma-separated line instead
    const commaSeparated = await request(app).post('/api/jobs').set('Authorization', asAdmin()).send({
      title: 'Risk Assessor', company: 'Courses4Me', location: 'Remote', category: 'Risk Assessor',
      salary: '£35,000', description: 'Assess and report on site risk.',
      requirements: 'NEBOSH, 3 years experience, Full UK licence'
    });
    expect(commaSeparated.status).toBe(201);
    expect(commaSeparated.body.data.requirements).toEqual(['NEBOSH', '3 years experience', 'Full UK licence']);
  });

  it('updates scalars without clearing the requirements, and replaces them when sent', async () => {
    const partial = await request(app).put(`/api/jobs/${listingId}`).set('Authorization', asAdmin()).send({ status: 'Paused' });
    expect(partial.status).toBe(200);
    expect(partial.body.data.status).toBe('Paused');
    expect(partial.body.data.requirements).toEqual(['CP licence', 'Clean driving licence']);

    const replaced = await request(app).put(`/api/jobs/${listingId}`).set('Authorization', asAdmin()).send({ requirements: ['CP licence only'] });
    expect(replaced.body.data.requirements).toEqual(['CP licence only']);

    expect((await request(app).put('/api/jobs/9999').set('Authorization', asAdmin()).send({ status: 'Closed' })).status).toBe(404);
  });

  it('deletes a vacancy', async () => {
    const created = await request(app).post('/api/jobs').set('Authorization', asAdmin()).send({
      title: 'Temporary Role', company: 'Courses4Me', location: 'London', category: 'Specialist',
      salary: '£100 per day', description: 'Short-term cover.'
    });
    const id = created.body.data.id;

    const res = await request(app).delete(`/api/jobs/${id}`).set('Authorization', asAdmin());
    expect(res.body).toMatchObject({ success: true, message: 'Job listing deleted successfully', data: {} });
    expect((await request(app).delete(`/api/jobs/${id}`).set('Authorization', asAdmin())).status).toBe(404);
  });
});

describe('POST /api/jobs/apply/:id', () => {
  it('accepts a guest application and emails the reference', async () => {
    sendEmail.mockClear();
    const res = await request(app).post('/api/jobs/apply/1').send(application());
    expect(res.status).toBe(201);

    expect(res.body.data).toMatchObject({
      jobTitle: 'Door Supervisor',
      firstName: 'Alex',
      applicantName: 'Alex Applicant',
      email: 'alex.applicant@example.test',
      status: 'Pending',
      cvFile: 'cv_resume.pdf'
    });
    expect(res.body.data.applicationReference).toMatch(/^REF-[A-Z0-9]{7}$/);
    expect(res.body.refNumber).toBe(res.body.data.applicationReference);
    // a guest has no account, so none is reported
    expect(res.body.user).toBeNull();
    expect(res.body.data.user).toBeNull();

    await flushPromises();
    expect(subjects().some(s => /Application Submitted Successfully/.test(s))).toBe(true);
    // the admins are told about it
    expect(mockDb.state.notifications.some(n => n.title === 'New Job Application')).toBe(true);
  });

  it('refuses a second application for the same vacancy', async () => {
    const again = await request(app).post('/api/jobs/apply/1').send(application());
    expect(again.status).toBe(400);
    expect(again.body.message).toMatch(/already applied/i);

    // the same candidate may still apply for a different vacancy
    const other = await request(app).post('/api/jobs/apply/2').send(application());
    expect(other.status).toBe(201);
    expect(other.body.data.jobTitle).toBe('CCTV Operator');
  });

  it('creates an account when the candidate supplies a password', async () => {
    const res = await request(app).post('/api/jobs/apply/1').send(application({
      email: 'new.candidate@example.test',
      firstName: 'New',
      lastName: 'Candidate',
      password: 'C4ndidate!Pass'
    }));
    expect(res.status).toBe(201);
    expect(res.body.user).toMatchObject({ email: 'new.candidate@example.test', role: 'customer' });
    expect(typeof res.body.user._id).toBe('string');

    const created = mockDb.findUser('new.candidate@example.test');
    expect(created.password_hash).toMatch(/^\$2[aby]\$/);
    // the application is linked to that account
    expect(res.body.data.user).toBe(String(created.id));

    // and the new account can sign in
    expect((await request(app).post('/api/auth/login').send({ email: 'new.candidate@example.test', password: 'C4ndidate!Pass' })).status).toBe(200);
  });

  it('links a signed-in candidate to their own application', async () => {
    const cathy = mockDb.findUser('cathy@example.test');
    const res = await request(app).post('/api/jobs/apply/2').set('Authorization', asCandidate())
      .send(application({ email: 'someone.else@example.test', firstName: 'Cathy', lastName: 'Candidate' }));
    expect(res.status).toBe(201);
    // the account of the signed-in user wins over the posted email
    expect(res.body.data.user).toBe(String(cathy.id));
  });

  it('404s for an unknown vacancy and validates the form', async () => {
    expect((await request(app).post('/api/jobs/apply/9999').send(application({ email: 'x@example.test' }))).status).toBe(404);

    const invalid = await request(app).post('/api/jobs/apply/1').send({ firstName: 'Only' });
    expect(invalid.status).toBe(400);
    expect(invalid.body.errors.map(e => e.field)).toEqual(
      expect.arrayContaining(['lastName', 'email', 'phone', 'address', 'city', 'postcode', 'license', 'experience', 'availability', 'cover'])
    );
  });
});

describe('GET /api/jobs/my-applications', () => {
  it('returns the candidate applications with the vacancy attached', async () => {
    const res = await request(app).get('/api/jobs/my-applications').set('Authorization', asCandidate());
    expect(res.status).toBe(200);
    expect(res.body.count).toBe(res.body.applications.length);
    expect(res.body.applications.length).toBeGreaterThan(0);

    const app1 = res.body.applications[0];
    expect(app1.jobId).toMatchObject({ title: 'CCTV Operator', company: 'SecureCo', location: 'Manchester' });
    expect(app1).toHaveProperty('applicationReference');
  });

  it('needs a token', async () => {
    expect((await request(app).get('/api/jobs/my-applications')).status).toBe(401);
  });
});

describe('admin review queue', () => {
  it('lists every application with search and status filters', async () => {
    const res = await request(app).get('/api/jobs/applications').set('Authorization', asAdmin());
    expect(res.status).toBe(200);
    expect(res.body.count).toBe(res.body.applications.length);
    expect(res.body.data.applications).toEqual(res.body.applications);

    const search = await request(app).get('/api/jobs/applications?search=alex.applicant').set('Authorization', asAdmin());
    expect(search.body.applications.every(a => a.email === 'alex.applicant@example.test')).toBe(true);

    const pending = await request(app).get('/api/jobs/applications?status=Pending').set('Authorization', asAdmin());
    expect(pending.body.applications.every(a => a.status === 'Pending')).toBe(true);

    expect((await request(app).get('/api/jobs/applications?status=Maybe').set('Authorization', asAdmin())).status).toBe(400);
    expect((await request(app).get('/api/jobs/applications').set('Authorization', asCandidate())).status).toBe(403);
  });

  it('moves an application through the stages and emails the candidate', async () => {
    const queue = await request(app).get('/api/jobs/applications').set('Authorization', asAdmin());
    const target = queue.body.applications[0];
    sendEmail.mockClear();

    const res = await request(app).put(`/api/jobs/applications/${target.id}/status`).set('Authorization', asAdmin())
      .send({ status: 'Shortlisted', reason: 'Strong experience' });
    expect(res.status).toBe(200);
    expect(res.body.data.status).toBe('Shortlisted');

    await flushPromises();
    const sent = sendEmail.mock.calls.find(([m]) => /Application Update/.test(m.subject));
    expect(sent).toBeDefined();
    expect(sent[0].html).toContain('Strong experience');

    expect((await request(app).put(`/api/jobs/applications/${target.id}/status`).set('Authorization', asAdmin()).send({ status: 'Maybe' })).status).toBe(400);
    expect((await request(app).put('/api/jobs/applications/9999/status').set('Authorization', asAdmin()).send({ status: 'Accepted' })).status).toBe(404);
    expect((await request(app).put(`/api/jobs/applications/${target.id}/status`).set('Authorization', asCandidate()).send({ status: 'Accepted' })).status).toBe(403);
  });

  it('keeps an application readable after its vacancy is removed', async () => {
    const created = await request(app).post('/api/jobs').set('Authorization', asAdmin()).send({
      title: 'Doomed Vacancy', company: 'Courses4Me', location: 'London', category: 'Specialist',
      salary: '£100', description: 'This role will be withdrawn.'
    });
    const jobId = created.body.data.id;

    const applied = await request(app).post(`/api/jobs/apply/${jobId}`).send(application({ email: 'doomed@example.test' }));
    const applicationId = applied.body.data.id;

    await request(app).delete(`/api/jobs/${jobId}`).set('Authorization', asAdmin());

    const queue = await request(app).get('/api/jobs/applications').set('Authorization', asAdmin());
    const orphan = queue.body.applications.find(a => a.id === applicationId);
    expect(orphan).toBeDefined();
    // the title was captured on the application, so it still reads correctly
    expect(orphan.jobTitle).toBe('Doomed Vacancy');
    expect(orphan.jobId).toBeNull();
  });
});
