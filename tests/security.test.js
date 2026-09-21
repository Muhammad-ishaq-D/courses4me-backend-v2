/**
 * Hardening features: per-account lockout, forgot-password throttle, JWT
 * issuer/audience pinning, request ids, audit trail, body limits, health.
 */
const request = require('supertest');
const { createMockDb, tokenFor, foreignTokenFor, flushPromises } = require('./helpers/mockDb');

const mockDb = createMockDb({
  users: [
    { id: 1, name: 'Site Admin', email: 'admin@courses4me.test', password: 'Adm1n!Pass', role: 'admin' },
    { id: 2, name: 'Locky Lou', email: 'lou@example.test', password: 'L0cky!Pass', role: 'customer' },
    { id: 3, name: 'Resetta', email: 'resetta@example.test', password: 'R3set!Pass', role: 'customer' }
  ]
});

jest.mock('../src/config/db', () => mockDb);
jest.mock('../src/utils/sendEmail', () => jest.fn(async () => ({})));

const sendEmail = require('../src/utils/sendEmail');
const app = require('../src/app');
const lockout = require('../src/services/loginLockoutService');
const { MAX_REQUESTS_PER_HOUR } = require('../src/services/passwordResetService');

const login = (email, password) => request(app).post('/api/auth/login').send({ email, password });
const auditActions = (userId) => mockDb.state.audit.filter(a => a.user_id === userId).map(a => a.action);

describe('per-account login lockout', () => {
  it(`locks the account after ${lockout.MAX_ATTEMPTS} wrong passwords and clears on success`, async () => {
    for (let i = 1; i < lockout.MAX_ATTEMPTS; i++) {
      expect((await login('lou@example.test', 'wrong')).status).toBe(401);
    }
    const locking = await login('lou@example.test', 'wrong');
    expect(locking.status).toBe(423);
    expect(locking.body.error_code).toBe('ACCOUNT_LOCKED');

    // even the correct password is refused while locked
    const whileLocked = await login('lou@example.test', 'L0cky!Pass');
    expect(whileLocked.status).toBe(423);
    expect(whileLocked.body.message).toMatch(/locked for \d+ more minute/);

    // lock expires -> correct password works and counters reset
    mockDb.findUser('lou@example.test').locked_until = new Date(Date.now() - 1000);
    const ok = await login('lou@example.test', 'L0cky!Pass');
    expect(ok.status).toBe(200);
    expect(mockDb.findUser('lou@example.test')).toMatchObject({ failed_login_attempts: 0, locked_until: null });

    await flushPromises();
    expect(auditActions(2)).toEqual(expect.arrayContaining(['LOGIN_FAILED', 'LOGIN_LOCKED', 'LOGIN_SUCCESS']));
  });

  it('records failed logins for unknown emails without a user id', async () => {
    await login('nobody@example.test', 'x');
    await flushPromises();
    expect(mockDb.state.audit.some(a => a.action === 'LOGIN_FAILED' && a.user_id === null && a.details === 'unknown email')).toBe(true);
  });
});

describe('forgot-password throttle', () => {
  it(`sends at most ${MAX_REQUESTS_PER_HOUR} emails per account per hour but always answers the same`, async () => {
    sendEmail.mockClear();
    const responses = [];
    for (let i = 0; i < MAX_REQUESTS_PER_HOUR + 2; i++) {
      responses.push(await request(app).post('/api/portal/auth/forgot-password').send({ email: 'resetta@example.test' }));
    }
    expect(responses.every(r => r.status === 200 && r.body.message === responses[0].body.message)).toBe(true);
    expect(sendEmail).toHaveBeenCalledTimes(MAX_REQUESTS_PER_HOUR);
    await flushPromises();
    expect(auditActions(3)).toContain('PASSWORD_RESET_THROTTLED');
  });

  it('answers before the email is delivered and removes the request if delivery fails', async () => {
    sendEmail.mockClear();
    mockDb.state.resets = [];
    let release;
    sendEmail.mockImplementationOnce(() => new Promise((_, reject) => { release = () => reject(new Error('SMTP down')); }));

    const res = await request(app).post('/api/admin/auth/forgot-password').send({ email: 'admin@courses4me.test' });
    expect(res.status).toBe(200);
    expect(mockDb.state.resets).toHaveLength(1); // row exists while the email is in flight

    release();
    await flushPromises();
    expect(mockDb.state.resets).toHaveLength(0); // dropped after the failure
    expect(auditActions(1)).toContain('PASSWORD_RESET_DELIVERY_FAILED');
  });
});

describe('password change notifications', () => {
  it('emails the owner after a password change', async () => {
    sendEmail.mockClear();
    const user = mockDb.findUser('resetta@example.test');
    const res = await request(app)
      .put('/api/auth/update-password')
      .set('Authorization', `Bearer ${tokenFor(user)}`)
      .send({ currentPassword: 'R3set!Pass', newPassword: 'N3w!Resetta' });
    expect(res.status).toBe(200);
    await flushPromises();
    const notice = sendEmail.mock.calls.find(([m]) => /password was changed/i.test(m.subject));
    expect(notice).toBeDefined();
    expect(notice[0].email).toBe('resetta@example.test');
    expect(auditActions(3)).toContain('PASSWORD_CHANGED');
  });
});

describe('JWT pinning', () => {
  it('rejects a token signed with the right secret but another issuer', async () => {
    const admin = mockDb.findUser('admin@courses4me.test');
    const res = await request(app).get('/api/auth/me').set('Authorization', `Bearer ${foreignTokenFor(admin)}`);
    expect(res.status).toBe(401);
  });

  it('issues tokens that carry issuer and audience', async () => {
    const res = await request(app).post('/api/admin/auth/login').send({ email: 'admin@courses4me.test', password: 'Adm1n!Pass' });
    const payload = JSON.parse(Buffer.from(res.body.token.split('.')[1], 'base64url').toString());
    expect(payload).toMatchObject({ iss: 'courses4me-api', aud: 'courses4me', id: 1, role: 'admin' });
  });
});

describe('request ids, body limits, health', () => {
  it('every response carries X-Request-Id and error bodies echo it', async () => {
    const res = await request(app).get('/api/does-not-exist');
    expect(res.headers['x-request-id']).toMatch(/^[0-9a-f-]{36}$/);
    expect(res.body.requestId).toBe(res.headers['x-request-id']);

    const custom = await request(app).get('/health').set('X-Request-Id', 'proxy-abc-12345');
    expect(custom.headers['x-request-id']).toBe('proxy-abc-12345');
  });

  it('caps ordinary JSON bodies at 1 MB but allows larger profile-photo payloads', async () => {
    const big = 'x'.repeat(1.5 * 1024 * 1024);
    const tooBig = await request(app).post('/api/auth/check-email').send({ email: 'a@b.co', padding: big });
    expect(tooBig.status).toBe(413);

    const user = mockDb.findUser('resetta@example.test');
    const profile = await request(app).put('/api/auth/profile').set('Authorization', `Bearer ${tokenFor(user)}`).send({ bio: 'ok', profileImage: `https://cdn.test/${big}` });
    expect(profile.status).not.toBe(413);
  });

  it('GET /health reports the database state', async () => {
    const up = await request(app).get('/health');
    expect(up.body).toMatchObject({ success: true, db: 'up' });

    mockDb.raw.mockImplementationOnce(async () => { throw new Error('gone'); });
    const down = await request(app).get('/health');
    expect(down.status).toBe(200);
    expect(down.body.db).toBe('down');
  });
});
