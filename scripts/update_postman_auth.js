/**
 * Upserts the Authentication folders into postman_collection.json.
 *
 *   npm run postman:auth
 *
 * Creates the collection if it does not exist yet, replaces the folders it
 * owns (0–5) and leaves every other folder untouched, so each module's
 * `scripts/update_postman_<module>.js` can maintain its own section.
 *
 * Collection variables: baseUrl, token (customer), adminToken, reset_token,
 * userId, testEmail/testPassword, adminEmail/adminPassword. Login requests
 * store their JWT automatically; Verify OTP stores reset_token.
 */
const fs = require('fs');
const path = require('path');

const file = path.join(__dirname, '..', 'postman_collection.json');

const COLLECTION_NAME = 'Courses4Me API v2';
const VARIABLES = [
  { key: 'hostUrl', value: 'http://localhost:5000' },
  { key: 'baseUrl', value: 'http://localhost:5000/api' },
  { key: 'token', value: '' },
  { key: 'adminToken', value: '' },
  { key: 'reset_token', value: '' },
  { key: 'userId', value: '1' },
  { key: 'testEmail', value: 'customer@example.com' },
  { key: 'testPassword', value: 'Customer!Pass1' },
  { key: 'adminEmail', value: 'admin@example.com' },
  { key: 'adminPassword', value: 'Admin!Pass1' }
];

// ── request builders ──────────────────────────────────────────────────────
const url = (p, query) => {
  const raw = `{{baseUrl}}${p}${query ? `?${query.map(q => `${q.key}=${q.value}`).join('&')}` : ''}`;
  const out = { raw, host: ['{{baseUrl}}'], path: p.replace(/^\//, '').split('/') };
  if (query) out.query = query;
  return out;
};
const json = (body) => ({ mode: 'raw', raw: JSON.stringify(body, null, 2), options: { raw: { language: 'json' } } });
const bearer = (variable) => [{ key: 'Authorization', value: `Bearer {{${variable}}}` }];
const test = (lines) => [{ listen: 'test', script: { type: 'text/javascript', exec: lines } }];

const req = ({ name, method, path: p, auth, body, query, description, tests }) => {
  const item = {
    name,
    request: {
      method,
      header: [{ key: 'Content-Type', value: 'application/json' }, ...(auth ? bearer(auth) : [])],
      url: url(p, query),
      description
    }
  };
  if (body) item.request.body = json(body);
  if (tests) item.event = test(tests);
  return item;
};

const okTest = (label = 'Request succeeded') => [
  `pm.test("${label}", function () {`,
  '    pm.expect(pm.response.code).to.be.oneOf([200, 201]);',
  '    pm.expect(pm.response.json().success).to.eql(true);',
  '});'
];
const saveTokenTest = (variable) => [
  ...okTest('Logged in'),
  'var body = pm.response.json();',
  `if (body.token) { pm.collectionVariables.set("${variable}", body.token); }`,
  `if (body.user && body.user.id) { pm.collectionVariables.set("userId", body.user.id); }`
];

// ── folders owned by this script ─────────────────────────────────────────
const folders = [
  {
    name: '1. Authentication (Customer)',
    description: 'Customer portal signup/login and own-profile endpoints. Login stores {{token}}.',
    item: [
      req({ name: 'Register', method: 'POST', path: '/auth/register',
        body: { name: 'Test Customer', email: '{{testEmail}}', password: '{{testPassword}}' },
        description: 'Creates a customer account. Password: 8+ chars, one uppercase, one number, one symbol.',
        tests: okTest('Registered') }),
      req({ name: 'Login', method: 'POST', path: '/auth/login',
        body: { email: '{{testEmail}}', password: '{{testPassword}}' },
        description: 'Customer login. Admin/editor accounts are refused here (use 2. Admin Auth). 5 wrong passwords lock the account for 15 minutes (423 ACCOUNT_LOCKED).',
        tests: saveTokenTest('token') }),
      req({ name: 'Check Email', method: 'POST', path: '/auth/check-email',
        body: { email: '{{testEmail}}' },
        description: 'Returns { exists } — true when an account or a past booking uses this email.',
        tests: okTest() }),
      req({ name: 'Get Me', method: 'GET', path: '/auth/me', auth: 'token', description: 'Full profile including activityHistory.', tests: okTest() }),
      req({ name: 'Get Profile (alias)', method: 'GET', path: '/auth/profile', auth: 'token', tests: okTest() }),
      req({ name: 'Update Details', method: 'PUT', path: '/auth/updatedetails', auth: 'token',
        body: { name: 'Test Customer Updated', phone: '07111111111' },
        description: 'Partial update — only sent fields change (name, email, phone, jobTitle, bio, profileImage). profileImage may be a URL or a data:image base64 string.',
        tests: okTest('Profile updated') }),
      req({ name: 'Update Profile (alias, with photo)', method: 'PUT', path: '/auth/profile', auth: 'token',
        body: { bio: 'Hello from Postman', profileImage: 'https://example.com/avatar.png' },
        tests: okTest('Profile updated') }),
      req({ name: 'Update Password', method: 'PUT', path: '/auth/update-password', auth: 'token',
        body: { currentPassword: '{{testPassword}}', newPassword: '{{testPassword}}' },
        description: 'Bumps tokenVersion, so every existing session (including {{token}}) is logged out — run Login again afterwards. The account owner receives a password-changed email.',
        tests: okTest('Password updated') })
    ]
  },
  {
    name: '2. Admin Auth',
    description: 'Admin panel login and OTP password reset. Login stores {{adminToken}}; Verify OTP stores {{reset_token}}.',
    item: [
      req({ name: 'Admin Login', method: 'POST', path: '/admin/auth/login',
        body: { email: '{{adminEmail}}', password: '{{adminPassword}}' },
        description: 'Admin panel login. A login from a new device (user-agent + IP) raises an admin notification. 5 wrong passwords lock the account for 15 minutes (423 ACCOUNT_LOCKED).',
        tests: saveTokenTest('adminToken') }),
      req({ name: 'Forgot Password (send OTP)', method: 'POST', path: '/admin/auth/forgot-password',
        body: { email: '{{adminEmail}}' },
        description: 'Always answers 200 with a generic message. Emails a 6-digit OTP valid for 10 minutes (max 3 emails per account per hour).',
        tests: okTest('Generic success') }),
      req({ name: 'Verify OTP', method: 'POST', path: '/admin/auth/verify-otp',
        body: { code: '123456' },
        description: 'Exchange the emailed code (field `code` or `otp`) for a single-use reset token valid 10 minutes.',
        tests: [
          'let jsonData;',
          'try { jsonData = pm.response.json(); } catch (error) { throw new Error("Verify OTP response is not valid JSON"); }',
          'pm.test("OTP verified", function () { pm.expect(jsonData.success).to.eql(true); });',
          'if (jsonData.success && jsonData.data && jsonData.data.resetToken) {',
          '    pm.collectionVariables.set("reset_token", jsonData.data.resetToken);',
          '}'
        ] }),
      req({ name: 'Reset Password', method: 'POST', path: '/admin/auth/reset-password',
        body: { resetToken: '{{reset_token}}', newPassword: '{{adminPassword}}' },
        description: 'Consumes {{reset_token}}, sets the password and logs every session out.',
        tests: okTest('Password reset') })
    ]
  },
  {
    name: '3. Portal Password Reset',
    description: 'Customer forgot-password via emailed link. The link is FRONTEND_URL/reset-password?token=…; paste the token into {{reset_token}}.',
    item: [
      req({ name: 'Forgot Password (send link)', method: 'POST', path: '/portal/auth/forgot-password',
        body: { email: '{{testEmail}}' },
        description: 'Always answers 200 with a generic message. Admin accounts are ignored here. Max 3 emails per account per hour.',
        tests: okTest('Generic success') }),
      req({ name: 'Reset Password', method: 'POST', path: '/portal/auth/reset-password',
        body: { resetToken: '{{reset_token}}', newPassword: '{{testPassword}}' },
        description: 'Legacy body { token, password } is still accepted.',
        tests: okTest('Password reset') })
    ]
  },
  {
    name: '4. User Management (Admin)',
    description: 'Requires {{adminToken}} with role admin (editors are refused).',
    item: [
      req({ name: 'Get Users', method: 'GET', path: '/auth/users', auth: 'adminToken',
        query: [
          { key: 'search', value: '', description: 'name / email / phone contains', disabled: true },
          { key: 'role', value: 'customer', description: 'admin | editor | customer', disabled: true },
          { key: 'status', value: 'active', description: 'active | inactive | suspended | blocked | pending verification', disabled: true }
        ],
        description: 'Users with activityHistory and booking stats (totalBookings, totalSpent, completedCourses, attendanceStatus).',
        tests: [...okTest(), 'var body = pm.response.json();', 'if (body.data && body.data[0]) { pm.collectionVariables.set("userId", body.data[0].id); }'] }),
      req({ name: 'Get User Counts', method: 'GET', path: '/auth/counts', auth: 'adminToken', description: '{ counts: { customer, admin, editor, total } }', tests: okTest() }),
      req({ name: 'Update User Status', method: 'PUT', path: '/auth/users/{{userId}}/status', auth: 'adminToken',
        body: { status: 'suspended', reason: 'Testing from Postman' },
        description: 'Suspended/blocked users cannot log in and existing tokens are refused with 403.',
        tests: okTest('Status updated') }),
      req({ name: 'Reactivate User', method: 'PUT', path: '/auth/users/{{userId}}/status', auth: 'adminToken',
        body: { status: 'active', reason: '' }, tests: okTest('Status updated') }),
      req({ name: 'Clear User History', method: 'DELETE', path: '/auth/users/{{userId}}/history', auth: 'adminToken',
        description: 'Wipes the activity timeline and status reason, leaving one "History Cleared" entry.',
        tests: okTest('History cleared') })
    ]
  },
  {
    name: '5. Social Login (browser)',
    description: 'Redirect flows — open these URLs in a browser, not in Postman. The callback redirects to FRONTEND_URL/<redirect>?token=<jwt>.',
    item: [
      req({ name: 'Google', method: 'GET', path: '/auth/google', query: [{ key: 'redirect', value: '/dashboard' }] }),
      req({ name: 'Facebook', method: 'GET', path: '/auth/facebook', query: [{ key: 'redirect', value: '/dashboard' }] })
    ]
  }
];

// ── health (kept at the top of every module's collection) ────────────────
const healthFolder = {
  name: '0. Health',
  item: [
    { name: 'Health Check', request: { method: 'GET', header: [], url: { raw: '{{hostUrl}}/health', host: ['{{hostUrl}}'], path: ['health'] }, description: 'Always 200; the db field is up|down. Every response carries an X-Request-Id header.' }, event: test([...okTest('API healthy'), 'pm.test("Database up", function () { pm.expect(pm.response.json().db).to.eql("up"); });']) }
  ]
};

// ── merge ─────────────────────────────────────────────────────────────────
let data;
if (fs.existsSync(file)) {
  data = JSON.parse(fs.readFileSync(file, 'utf8'));
} else {
  data = {
    info: {
      name: COLLECTION_NAME,
      description: 'Courses4Me backend v2 (Express + MySQL). Collection variables hold test accounts only — never real customers.',
      schema: 'https://schema.getpostman.com/json/collection/v2.1.0/collection.json'
    },
    item: [],
    variable: []
  };
}

// variables: add missing, keep existing values
for (const v of VARIABLES) {
  if (!data.variable.find(x => x.key === v.key)) data.variable.push({ ...v, type: 'string' });
}

// folders: replace ours by name prefix, keep the rest, sort by leading number
const owned = new Set([healthFolder.name, ...folders.map(f => f.name)]);
data.item = data.item.filter(f => !owned.has(f.name));
data.item.push(healthFolder, ...folders);
data.item.sort((a, b) => (parseFloat(a.name) || 0) - (parseFloat(b.name) || 0));

fs.writeFileSync(file, JSON.stringify(data, null, 2) + '\n');
console.log(`Updated ${path.basename(file)}: ${data.item.length} folders, ${data.item.reduce((n, f) => n + f.item.length, 0)} requests.`);
