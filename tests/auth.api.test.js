/**
 * HTTP-level tests for the authentication module against the in-memory DB.
 * Covers: login (customer/admin audiences, social-only, blocked), register,
 * check-email, profile, password change, admin user management, OTP and
 * portal reset flows, and the JWT middleware (tokenVersion / role guards).
 */
const request = require('supertest');
const { createMockDb, tokenFor } = require('./helpers/mockDb');

const mockDb = createMockDb({
  users: [
    { id: 1, name: 'Site Admin', email: 'admin@courses4me.test', password: 'Adm1n!Pass', role: 'admin' },
    { id: 2, name: 'Editor Ed', email: 'editor@courses4me.test', password: 'Ed1tor!Pass', role: 'editor' },
    { id: 3, name: 'Cathy Customer', email: 'cathy@example.test', password: 'Cust0mer!Pass', role: 'customer', phone: '07000000001' },
    { id: 4, name: 'Google Gus', email: 'gus@example.test', password_hash: null, google_id: 'g-123', role: 'customer' },
    { id: 5, name: 'Blocked Bob', email: 'bob@example.test', password: 'Bl0cked!Pass', role: 'customer', status: 'blocked', status_reason: 'Chargeback' }
  ]
});

jest.mock('../src/config/db', () => mockDb);
jest.mock('../src/utils/sendEmail', () => jest.fn(async () => ({})));
jest.mock('../src/config/cloudinary', () => ({ uploader: { upload: jest.fn(async () => ({ secure_url: 'https://cdn.test/p.jpg' })) } }));

const sendEmail = require('../src/utils/sendEmail');
const app = require('../src/app');

const admin = () => mockDb.findUser('admin@courses4me.test');
const cathy = () => mockDb.findUser('cathy@example.test');
const lastEmail = () => sendEmail.mock.calls[sendEmail.mock.calls.length - 1][0];

describe('POST /api/auth/login (customer portal)', () => {
  it('returns a token and the compact user for valid credentials', async () => {
    const res = await request(app).post('/api/auth/login').send({ email: 'Cathy@Example.test', password: 'Cust0mer!Pass' });
    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    expect(typeof res.body.token).toBe('string');
    expect(res.body.user).toMatchObject({ id: 3, email: 'cathy@example.test', role: 'customer' });
    expect(res.body.user).not.toHaveProperty('password_hash');
    // login is recorded on the activity timeline
    expect(mockDb.state.activity.some(a => a.user_id === 3 && a.action === 'Login')).toBe(true);
  });

  it('rejects a wrong password and an unknown email with the same message', async () => {
    const wrong = await request(app).post('/api/auth/login').send({ email: 'cathy@example.test', password: 'nope' });
    const unknown = await request(app).post('/api/auth/login').send({ email: 'nobody@example.test', password: 'nope' });
    expect(wrong.status).toBe(401);
    expect(unknown.status).toBe(401);
    expect(wrong.body.message).toBe(unknown.body.message);
  });

  it('tells social-only accounts which provider to use', async () => {
    const res = await request(app).post('/api/auth/login').send({ email: 'gus@example.test', password: 'whatever' });
    expect(res.status).toBe(401);
    expect(res.body.socialProvider).toBe('google');
  });

  it('refuses blocked accounts with the reason', async () => {
    const res = await request(app).post('/api/auth/login').send({ email: 'bob@example.test', password: 'Bl0cked!Pass' });
    expect(res.status).toBe(403);
    expect(res.body.message).toMatch(/blocked.*Chargeback/);
  });

  it('does not let admins into the customer portal', async () => {
    const res = await request(app).post('/api/auth/login').send({ email: 'admin@courses4me.test', password: 'Adm1n!Pass' });
    expect(res.status).toBe(403);
    expect(res.body.message).toMatch(/admin dashboard/i);
  });

  it('validates the payload (400)', async () => {
    const res = await request(app).post('/api/auth/login').send({ email: 'not-an-email' });
    expect(res.status).toBe(400);
    expect(res.body.errors.map(e => e.field)).toEqual(expect.arrayContaining(['email', 'password']));
  });
});

describe('POST /api/admin/auth/login', () => {
  it('logs an admin in and records the device', async () => {
    const res = await request(app).post('/api/admin/auth/login').set('User-Agent', 'jest-agent').send({ email: 'admin@courses4me.test', password: 'Adm1n!Pass' });
    expect(res.status).toBe(200);
    expect(res.body.user.role).toBe('admin');
    expect(mockDb.state.devices.filter(d => d.user_id === 1)).toHaveLength(1);

    // same device again -> no second row
    await request(app).post('/api/admin/auth/login').set('User-Agent', 'jest-agent').send({ email: 'admin@courses4me.test', password: 'Adm1n!Pass' });
    expect(mockDb.state.devices.filter(d => d.user_id === 1)).toHaveLength(1);
  });

});

describe('POST /api/auth/register', () => {
  it('creates a customer with a hashed password and refuses any other role', async () => {
    expect((await request(app).post('/api/auth/register').send({ name: 'New Nia', email: 'nia@example.test', password: 'N3w!Password', role: 'admin' })).status).toBe(400);
    const res = await request(app).post('/api/auth/register').send({ name: 'New Nia', email: 'nia@example.test', password: 'N3w!Password', role: 'customer' });
    expect(res.status).toBe(201);
    const nia = mockDb.findUser('nia@example.test');
    expect(nia.role).toBe('customer');
    expect(nia.password_hash).not.toBe('N3w!Password');
    expect(nia.password_hash).toMatch(/^\$2[aby]\$/);

    const login = await request(app).post('/api/auth/login').send({ email: 'nia@example.test', password: 'N3w!Password' });
    expect(login.status).toBe(200);
  });

  it('rejects duplicates and points social accounts to their provider', async () => {
    const dup = await request(app).post('/api/auth/register').send({ name: 'Cathy', email: 'cathy@example.test', password: 'N3w!Password' });
    expect(dup.status).toBe(400);
    const social = await request(app).post('/api/auth/register').send({ name: 'Gus', email: 'gus@example.test', password: 'N3w!Password' });
    expect(social.status).toBe(400);
    expect(social.body.socialProvider).toBe('google');
  });
});

describe('POST /api/auth/check-email', () => {
  it('reports whether an account exists (case-insensitive)', async () => {
    const yes = await request(app).post('/api/auth/check-email').send({ email: 'CATHY@example.test' });
    const no = await request(app).post('/api/auth/check-email').send({ email: 'ghost@example.test' });
    expect(yes.body).toEqual({ success: true, exists: true });
    expect(no.body).toEqual({ success: true, exists: false });
  });
});

describe('profile routes', () => {
  it('GET /api/auth/me returns the full public user with activity history', async () => {
    const res = await request(app).get('/api/auth/me').set('Authorization', `Bearer ${tokenFor(cathy())}`);
    expect(res.status).toBe(200);
    expect(res.body.data).toMatchObject({ id: 3, _id: '3', email: 'cathy@example.test' });
    expect(res.body.data).toHaveProperty('billingAddress');
    expect(Array.isArray(res.body.data.activityHistory)).toBe(true);
    expect(res.body.data).not.toHaveProperty('password_hash');
  });

  it('PUT /api/auth/profile updates fields, uploads base64 photos and logs the change', async () => {
    const res = await request(app)
      .put('/api/auth/profile')
      .set('Authorization', `Bearer ${tokenFor(cathy())}`)
      .send({ phone: '07999999999', profileImage: 'data:image/png;base64,AAAA' });
    expect(res.status).toBe(200);
    expect(res.body.data.phone).toBe('07999999999');
    expect(res.body.data.profileImage).toBe('https://cdn.test/p.jpg');
    expect(res.body.data.activityHistory.some(a => a.action === 'Profile Update' && /Phone/.test(a.details))).toBe(true);
  });

  it('PUT /api/auth/profile answers 409 for an email already used by someone else', async () => {
    const res = await request(app).put('/api/auth/profile').set('Authorization', `Bearer ${tokenFor(cathy())}`).send({ email: 'admin@courses4me.test' });
    expect(res.status).toBe(409);
  });

  it('PUT /api/auth/update-password bumps tokenVersion and invalidates the old token', async () => {
    const oldToken = tokenFor(cathy());
    const res = await request(app)
      .put('/api/auth/update-password')
      .set('Authorization', `Bearer ${oldToken}`)
      .send({ currentPassword: 'Cust0mer!Pass', newPassword: 'Br4nd!NewPass' });
    expect(res.status).toBe(200);
    expect(cathy().token_version).toBe(1);

    const stale = await request(app).get('/api/auth/me').set('Authorization', `Bearer ${oldToken}`);
    expect(stale.status).toBe(401);
    const fresh = await request(app).get('/api/auth/me').set('Authorization', `Bearer ${tokenFor(cathy())}`);
    expect(fresh.status).toBe(200);

    const wrongCurrent = await request(app).put('/api/auth/update-password').set('Authorization', `Bearer ${tokenFor(cathy())}`).send({ currentPassword: 'nope', newPassword: 'An0ther!Pass' });
    expect(wrongCurrent.status).toBe(401);
  });
});

describe('JWT middleware', () => {
  it('rejects missing, malformed and mismatched-version tokens', async () => {
    expect((await request(app).get('/api/auth/me')).status).toBe(401);
    expect((await request(app).get('/api/auth/me').set('Authorization', 'Bearer not.a.jwt')).status).toBe(401);
    expect((await request(app).get('/api/auth/me').set('Authorization', `Bearer ${tokenFor(admin(), { tokenVersion: 42 })}`)).status).toBe(401);
    expect((await request(app).get('/api/auth/me').set('Authorization', `Bearer ${tokenFor({ id: 999, role: 'customer' })}`)).status).toBe(401);
  });

  it('blocks suspended/blocked accounts even with a valid token', async () => {
    const bob = mockDb.findUser('bob@example.test');
    const res = await request(app).get('/api/auth/me').set('Authorization', `Bearer ${tokenFor(bob)}`);
    expect(res.status).toBe(403);
  });

  it('enforces roles on admin routes', async () => {
    const asCustomer = await request(app).get('/api/auth/users').set('Authorization', `Bearer ${tokenFor(cathy())}`);
    expect(asCustomer.status).toBe(403);
    const asEditor = await request(app).get('/api/auth/counts').set('Authorization', `Bearer ${tokenFor(mockDb.findUser('editor@courses4me.test'))}`);
    expect(asEditor.status).toBe(403);
  });
});

describe('admin user management', () => {
  const asAdmin = () => `Bearer ${tokenFor(admin())}`;

  it('GET /api/auth/users lists users with stats and timeline', async () => {
    const res = await request(app).get('/api/auth/users').set('Authorization', asAdmin());
    expect(res.status).toBe(200);
    expect(res.body.count).toBe(res.body.data.length);
    const c = res.body.data.find(u => u.email === 'cathy@example.test');
    expect(c).toMatchObject({ totalBookings: 0, bookingCount: 0, totalSpent: 0, completedCourses: 0, attendanceStatus: 'New' });
    expect(Array.isArray(c.activityHistory)).toBe(true);
    expect(c).not.toHaveProperty('password_hash');
  });

  it('GET /api/auth/users supports search / role / status filters', async () => {
    const byRole = await request(app).get('/api/auth/users?role=admin').set('Authorization', asAdmin());
    expect(byRole.body.data.every(u => u.role === 'admin')).toBe(true);
    const bySearch = await request(app).get('/api/auth/users?search=cathy').set('Authorization', asAdmin());
    expect(bySearch.body.data.map(u => u.email)).toEqual(['cathy@example.test']);
    const bad = await request(app).get('/api/auth/users?status=deleted').set('Authorization', asAdmin());
    expect(bad.status).toBe(400);
  });

  it('GET /api/auth/counts returns totals by role', async () => {
    const res = await request(app).get('/api/auth/counts').set('Authorization', asAdmin());
    expect(res.status).toBe(200);
    expect(res.body.counts.admin).toBe(1);
    expect(res.body.counts.total).toBe(res.body.counts.admin + res.body.counts.editor + res.body.counts.customer);
  });

  it('PUT /api/auth/users/:id/status suspends with a reason and logs the admin', async () => {
    const res = await request(app).put('/api/auth/users/3/status').set('Authorization', asAdmin()).send({ status: 'suspended', reason: 'Abuse' });
    expect(res.status).toBe(200);
    expect(res.body.data.status).toBe('suspended');
    const entry = res.body.data.activityHistory.find(a => a.action === 'Status Change');
    expect(entry).toMatchObject({ reason: 'Abuse', adminName: 'Site Admin' });

    // suspended user can no longer log in
    const login = await request(app).post('/api/auth/login').send({ email: 'cathy@example.test', password: 'Br4nd!NewPass' });
    expect(login.status).toBe(403);

    expect((await request(app).put('/api/auth/users/999/status').set('Authorization', asAdmin()).send({ status: 'active' })).status).toBe(404);
    expect((await request(app).put('/api/auth/users/abc/status').set('Authorization', asAdmin()).send({ status: 'active' })).status).toBe(400);
  });

  it('DELETE /api/auth/users/:id/history wipes the timeline and leaves one audit entry', async () => {
    const res = await request(app).delete('/api/auth/users/3/history').set('Authorization', asAdmin());
    expect(res.status).toBe(200);
    expect(res.body.data.activityHistory).toHaveLength(1);
    expect(res.body.data.activityHistory[0].action).toBe('History Cleared');
    expect(res.body.data.statusReason).toBeNull(); // empty strings are stored as NULL
  });
});

describe('admin password reset (OTP flow)', () => {
  const generic = 'If an account exists, a verification code has been sent.';

  it('answers identically for unknown emails and customer emails, without sending', async () => {
    sendEmail.mockClear();
    const a = await request(app).post('/api/admin/auth/forgot-password').send({ email: 'ghost@example.test' });
    const b = await request(app).post('/api/admin/auth/forgot-password').send({ email: 'cathy@example.test' });
    expect(a.body.message).toBe(generic);
    expect(b.body.message).toBe(generic);
    expect(sendEmail).not.toHaveBeenCalled();
  });

  it('emails a 6-digit OTP, exchanges it once for a reset token, then resets the password', async () => {
    sendEmail.mockClear();
    const forgot = await request(app).post('/api/admin/auth/forgot-password').send({ email: 'admin@courses4me.test' });
    expect(forgot.status).toBe(200);
    expect(sendEmail).toHaveBeenCalledTimes(1);
    const otp = lastEmail().message.match(/code is: (\d{6})/)[1];
    // only the HMAC is stored
    expect(mockDb.state.resets.some(r => r.otp_hash === otp)).toBe(false);

    const bad = await request(app).post('/api/admin/auth/verify-otp').send({ code: otp === '000000' ? '111111' : '000000' });
    expect(bad.status).toBe(400);

    const verify = await request(app).post('/api/admin/auth/verify-otp').send({ code: otp });
    expect(verify.status).toBe(200);
    const { resetToken } = verify.body.data;
    expect(resetToken).toMatch(/^[0-9a-f]{64}$/);

    // OTP is single-use
    expect((await request(app).post('/api/admin/auth/verify-otp').send({ code: otp })).status).toBe(400);

    // a token issued for an admin can't be used on the portal endpoint
    expect((await request(app).post('/api/portal/auth/reset-password').send({ resetToken, newPassword: 'H1jack!Pass' })).status).toBe(400);

    const versionBefore = admin().token_version;
    const reset = await request(app).post('/api/admin/auth/reset-password').send({ resetToken, newPassword: 'Res3t!Admin' });
    expect(reset.status).toBe(200);
    expect(admin().token_version).toBe(versionBefore + 1);

    // reset token is single-use
    expect((await request(app).post('/api/admin/auth/reset-password').send({ resetToken, newPassword: 'Ag4in!Admin' })).status).toBe(400);

    const login = await request(app).post('/api/admin/auth/login').send({ email: 'admin@courses4me.test', password: 'Res3t!Admin' });
    expect(login.status).toBe(200);
  });

  it('a new request invalidates the previous OTP', async () => {
    sendEmail.mockClear();
    await request(app).post('/api/admin/auth/forgot-password').send({ email: 'editor@courses4me.test' });
    const first = lastEmail().message.match(/code is: (\d{6})/)[1];
    await request(app).post('/api/admin/auth/forgot-password').send({ email: 'editor@courses4me.test' });
    const second = lastEmail().message.match(/code is: (\d{6})/)[1];
    expect((await request(app).post('/api/admin/auth/verify-otp').send({ code: first })).status).toBe(first === second ? 200 : 400);
    if (first !== second) expect((await request(app).post('/api/admin/auth/verify-otp').send({ code: second })).status).toBe(200);
  });

  it('drops the request when the email cannot be sent', async () => {
    sendEmail.mockImplementationOnce(async () => { throw new Error('SMTP down'); });
    const before = mockDb.state.resets.length;
    const res = await request(app).post('/api/admin/auth/forgot-password').send({ email: 'admin@courses4me.test' });
    expect(res.status).toBe(200); // still generic
    expect(mockDb.state.resets.length).toBe(before); // row removed again
  });
});

describe('portal password reset (link flow)', () => {
  it('emails a link whose token resets the password once', async () => {
    sendEmail.mockClear();
    // ignore admins on the portal endpoint
    await request(app).post('/api/portal/auth/forgot-password').send({ email: 'admin@courses4me.test' });
    expect(sendEmail).not.toHaveBeenCalled();

    const res = await request(app).post('/api/portal/auth/forgot-password').send({ email: 'gus@example.test' });
    expect(res.status).toBe(200);
    const token = lastEmail().message.match(/token=([0-9a-f]{64})/)[1];

    // legacy field names still work
    const reset = await request(app).post('/api/portal/auth/reset-password').send({ token, password: 'Gus!Passw0rd' });
    expect(reset.status).toBe(200);
    expect((await request(app).post('/api/portal/auth/reset-password').send({ resetToken: token, newPassword: 'Gus!Passw0rd2' })).status).toBe(400);

    // the social-only account can now also log in with a password
    const login = await request(app).post('/api/auth/login').send({ email: 'gus@example.test', password: 'Gus!Passw0rd' });
    expect(login.status).toBe(200);
  });
});

describe('infrastructure', () => {
  it('GET /health is public', async () => {
    const res = await request(app).get('/health');
    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
  });

  it('unknown routes return a JSON 404', async () => {
    const res = await request(app).get('/api/nope');
    expect(res.status).toBe(404);
    expect(res.body).toMatchObject({ success: false });
  });

  it('routes of modules that are not online are not mounted', async () => {
    expect((await request(app).get('/api/jobs')).status).toBe(404);
  });
});
