/**
 * Upserts the Jobs folder into postman_collection.json.
 *
 *   npm run postman:jobs
 *
 * Owns folder "16. Jobs"; every other folder is left untouched.
 */
const fs = require('fs');
const path = require('path');

const file = path.join(__dirname, '..', 'postman_collection.json');
if (!fs.existsSync(file)) {
  console.error('postman_collection.json not found — run `npm run postman:auth` first.');
  process.exit(1);
}
const data = JSON.parse(fs.readFileSync(file, 'utf8'));

const VARIABLES = [
  { key: 'jobId', value: '1' },
  { key: 'jobApplicationId', value: '1' }
];

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

const listingPayload = {
  title: 'Door Supervisor',
  company: 'Courses4Me',
  location: 'London',
  type: 'Full-time',
  category: 'Door Supervisor',
  career: 'Door Supervisor',
  salary: '£12 - £14 per hour',
  description: 'Work the door at licensed venues across London, checking ID and keeping guests safe.',
  requirements: ['Valid SIA licence', '18 or over', 'Right to work in the UK'],
  status: 'Active',
  isFeatured: true
};

const applicationPayload = {
  firstName: 'Test',
  lastName: 'Candidate',
  email: '{{testEmail}}',
  phone: '07000000000',
  address: '12 Test Road',
  city: 'London',
  postcode: 'SW1A 1AA',
  license: 'SIA Licensed',
  experience: '2 years',
  availability: 'Immediately',
  cover: 'I would like to join the team because…',
  cvFile: 'cv_resume.pdf'
};

const folder = {
  name: '16. Jobs',
  description: 'The jobs board: vacancies and the applications against them. Reads are public, vacancy management and '
    + 'the review queue need {{adminToken}}. Paused and closed vacancies stay visible so the board can badge them.',
  item: [
    req({
      name: 'List Vacancies',
      method: 'GET',
      path: '/jobs',
      query: [
        { key: 'category', value: 'Door Supervisor', description: 'SIA Training, First Aid, Health & Safety, Specialist, Security Officer, Door Supervisor, Event Security, CCTV Operator, Close Protection, First Aider, Paediatric First Aider, Safety Inspector, Risk Assessor, Security Manager', disabled: true },
        { key: 'type', value: 'Full-time', description: 'Full-time | Part-time | Contract | Internship | Remote', disabled: true },
        { key: 'status', value: 'Active', description: 'Active | Paused | Closed', disabled: true },
        { key: 'search', value: 'supervisor', description: 'matches title, company or description', disabled: true }
      ],
      description: 'The same array comes back under `listings` and `data.listings`, with `count`.',
      tests: [...okTest('Vacancies listed'), 'var body = pm.response.json();', 'if (body.listings && body.listings[0]) { pm.collectionVariables.set("jobId", body.listings[0].id); }']
    }),
    req({ name: 'Get Vacancy', method: 'GET', path: '/jobs/{{jobId}}', description: 'Returned under `data` and `listing`.', tests: okTest() }),
    req({
      name: 'Create Vacancy',
      method: 'POST',
      path: '/jobs',
      auth: 'adminToken',
      body: listingPayload,
      description: 'Required: title, company, location, category, salary, description. `requirements` may be an array or '
        + 'one comma-separated line — both are stored as an ordered list.',
      tests: [...okTest('Vacancy created'), 'var body = pm.response.json();', 'if (body.data && body.data.id) { pm.collectionVariables.set("jobId", body.data.id); }']
    }),
    req({
      name: 'Update Vacancy',
      method: 'PUT',
      path: '/jobs/{{jobId}}',
      auth: 'adminToken',
      body: { status: 'Paused', salary: '£13 - £15 per hour' },
      description: 'Only the fields sent change. Sending `requirements` replaces the whole list; leaving it out keeps it.',
      tests: okTest('Vacancy updated')
    }),
    req({
      name: 'Delete Vacancy',
      method: 'DELETE',
      path: '/jobs/{{jobId}}',
      auth: 'adminToken',
      description: 'Applications already made are kept — they hold their own copy of the job title and their `jobId` becomes null.',
      tests: okTest('Vacancy deleted')
    }),
    req({
      name: 'Apply for a Vacancy',
      method: 'POST',
      path: '/jobs/apply/{{jobId}}',
      body: applicationPayload,
      description: 'Public. One application per candidate per vacancy, matched by account when signed in and by email otherwise. '
        + 'Add a `password` field to create an account with the application. Send an Authorization header to link it to an '
        + 'existing account. Returns the reference as `refNumber`.',
      tests: [...okTest('Application submitted'), 'var body = pm.response.json();', 'if (body.data && body.data.id) { pm.collectionVariables.set("jobApplicationId", body.data.id); }']
    }),
    req({
      name: 'My Applications',
      method: 'GET',
      path: '/jobs/my-applications',
      auth: 'token',
      description: 'Everything this candidate has applied for, by account or by the email on the account, with the vacancy attached as `jobId`.',
      tests: okTest()
    }),
    req({
      name: 'All Applications (admin)',
      method: 'GET',
      path: '/jobs/applications',
      auth: 'adminToken',
      query: [
        { key: 'status', value: 'Pending', description: 'Pending | Shortlisted | Interview | Rejected | Accepted', disabled: true },
        { key: 'search', value: 'candidate', description: 'matches first name, last name, email or job title', disabled: true }
      ],
      description: 'The same array under `applications` and `data.applications`.',
      tests: [...okTest(), 'var body = pm.response.json();', 'if (body.applications && body.applications[0]) { pm.collectionVariables.set("jobApplicationId", body.applications[0].id); }']
    }),
    req({
      name: 'Update Application Status',
      method: 'PUT',
      path: '/jobs/applications/{{jobApplicationId}}/status',
      auth: 'adminToken',
      body: { status: 'Shortlisted', reason: 'Strong experience for this role' },
      description: 'Moves the application to a new stage and emails the candidate. `reason` is optional and is included in that email.',
      tests: okTest('Status updated')
    })
  ]
};

for (const v of VARIABLES) {
  if (!data.variable.find(x => x.key === v.key)) data.variable.push({ ...v, type: 'string' });
}
data.item = data.item.filter(f => f.name !== folder.name);
data.item.push(folder);
data.item.sort((a, b) => (parseFloat(a.name) || 0) - (parseFloat(b.name) || 0));

fs.writeFileSync(file, JSON.stringify(data, null, 2) + '\n');
console.log(`Updated ${path.basename(file)}: ${data.item.length} folders, ${data.item.reduce((n, f) => n + f.item.length, 0)} requests.`);
