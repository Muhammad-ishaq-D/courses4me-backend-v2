/**
 * Upserts the Courses folder into postman_collection.json.
 *
 *   npm run postman:courses
 *
 * Owns folder "6. Courses" and leaves every other folder untouched.
 * Requires the collection to exist already (npm run postman:auth).
 */
const fs = require('fs');
const path = require('path');

const file = path.join(__dirname, '..', 'postman_collection.json');
if (!fs.existsSync(file)) {
  console.error('postman_collection.json not found — run `npm run postman:auth` first.');
  process.exit(1);
}
const data = JSON.parse(fs.readFileSync(file, 'utf8'));

const VARIABLES = [{ key: 'courseId', value: '1' }];

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

const samplePayload = {
  title: 'Door Supervisor Course',
  category: 'SIA Training',
  subtitle: 'SIA licence-linked qualification',
  level: 'Level 2',
  duration: '4 Days',
  shortDescription: 'Everything needed to apply for an SIA door supervisor licence.',
  fullDescription: 'The full syllabus, assessment format and licence application steps.',
  highlights: ['SIA approved centre', 'Exam included'],
  learningPoints: ['Conflict management', 'Physical intervention'],
  targetAudience: ['New entrants to the security industry'],
  requirements: ['18 or over', 'Photo ID'],
  guarantee: { title: 'Training Guarantee', description: "Free exam retakes if you don't pass first time" },
  thumbnail: 'https://res.cloudinary.com/demo/image/upload/sample.jpg',
  pricing: { basePrice: 225.5, salePrice: 199, originalPrice: 275 },
  instructor: { name: 'Jane Trainer', title: 'Lead Instructor', bio: '15 years in the industry' },
  locations: [
    {
      name: 'London Centre',
      address: '1 Test Street, London',
      postcode: 'SW1A 1AA',
      parkingMain: 'Paid street parking',
      commuteMain: '5 min from Westminster station',
      schedules: [
        { time: '09:00 - 17:00', startDate: '2026-11-02', endDate: '2026-11-05', price: 225.5, seatsAvailable: 15 }
      ]
    }
  ],
  status: 'Published',
  isPopular: true
};

const folder = {
  name: '6. Courses',
  description: 'Public catalogue and admin course management. Writes need {{adminToken}} with the admin role. '
    + 'Venue postcodes are geocoded server-side, so they must be real UK postcodes that match the venue name.',
  item: [
    req({
      name: 'List Courses',
      method: 'GET',
      path: '/courses',
      query: [
        { key: 'category', value: 'SIA Training', description: 'SIA Training | Specialist | First Aid | Health & Safety | Hospitality', disabled: true },
        { key: 'status', value: 'Published', description: 'Published | Draft | Archived (drafts need an admin token)', disabled: true },
        { key: 'search', value: 'door', description: 'matches title and short description', disabled: true },
        { key: 'location', value: 'London', description: 'matches venue name, address or postcode', disabled: true }
      ],
      description: 'Without an admin token only Published courses are returned. Each course carries its lists, '
        + 'venues (with schedules) and a flattened `sessions` array.',
      tests: [...okTest('Courses listed'), 'var body = pm.response.json();', 'if (body.data && body.data[0]) { pm.collectionVariables.set("courseId", body.data[0].id); }']
    }),
    req({
      name: 'List Courses (admin, includes drafts)',
      method: 'GET',
      path: '/courses',
      auth: 'adminToken',
      tests: okTest('Courses listed')
    }),
    req({
      name: 'Category Stats',
      method: 'GET',
      path: '/courses/stats/categories',
      description: 'Course count per category: [{ _id, count }]. Published only unless an admin token is sent.',
      tests: okTest()
    }),
    req({
      name: 'Get Course',
      method: 'GET',
      path: '/courses/{{courseId}}',
      description: 'A draft or archived course answers 403 without an admin token. An unknown id answers 404.',
      tests: okTest()
    }),
    req({
      name: 'Create Course',
      method: 'POST',
      path: '/courses',
      auth: 'adminToken',
      body: samplePayload,
      description: 'Required: title, category, duration, shortDescription (20+ chars), fullDescription, pricing.basePrice. '
        + 'Send multipart/form-data with `thumbnail` / `instructorPhoto` files to upload images instead of passing URLs; '
        + 'nested fields then go as JSON strings.',
      tests: [...okTest('Course created'), 'var body = pm.response.json();', 'if (body.data && body.data.id) { pm.collectionVariables.set("courseId", body.data.id); }']
    }),
    req({
      name: 'Update Course (partial)',
      method: 'PUT',
      path: '/courses/{{courseId}}',
      auth: 'adminToken',
      body: { status: 'Draft', pricing: { basePrice: 249 }, isPopular: false },
      description: 'Only the fields sent are changed. Sending `highlights`, `learningPoints`, `targetAudience`, '
        + '`requirements` or `locations` replaces that list entirely; leaving one out keeps it.',
      tests: okTest('Course updated')
    }),
    req({
      name: 'Update Course (replace venues)',
      method: 'PUT',
      path: '/courses/{{courseId}}',
      auth: 'adminToken',
      body: { locations: samplePayload.locations },
      tests: okTest('Course updated')
    }),
    req({
      name: 'Delete Course',
      method: 'DELETE',
      path: '/courses/{{courseId}}',
      auth: 'adminToken',
      description: 'Removes the course with its lists, venues and schedules.',
      tests: okTest('Course deleted')
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
