/**
 * Upserts the Licences folder into postman_collection.json.
 *
 *   npm run postman:licenses
 *
 * Owns folder "15. Licences"; every other folder is left untouched.
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
  { key: 'licenseId', value: '1' },
  { key: 'licenseScheduleId', value: '1' }
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

const samplePayload = {
  title: 'SIA Door Supervisor Licence',
  licenseType: 'Door Supervisor',
  category: 'SIA Training',
  subtitle: 'Work the door at licensed venues',
  shortDescription: 'The licence you need to work as a door supervisor in the UK.',
  fullDescription: 'What the licence covers, how to apply for it and how to renew it.',
  thumbnail: 'https://res.cloudinary.com/demo/image/upload/sample.jpg',
  salary: '£12 - £16 per hour',
  duration: '4 Days',
  valid: '3 Years',
  experience: '5 Years',
  trainingCount: '12 Courses',
  rating: '4.9/5',
  highlights: ['SIA approved centre', 'Exam included', 'Weekend dates available'],
  learningPoints: ['Conflict management', 'Physical intervention', 'Emergency procedures'],
  requirements: ['18 or over', 'Photo ID', 'Right to work in the UK'],
  applicationSteps: [
    { title: 'Complete the training', desc: 'Attend the four-day course and pass the exams' },
    { title: 'Apply to the SIA', desc: 'Submit your application with your training certificate' },
    { title: 'Receive your licence', desc: 'The SIA posts your licence within 25 working days' }
  ],
  pricingBreakdown: [
    { label: 'Course fee', price: '£220' },
    { label: 'SIA application', price: '£184' },
    { label: 'Exam retake', price: 'Included' }
  ],
  renewalInfo: 'Apply to renew within three months of your expiry date.',
  pricing: { basePrice: 220, salePrice: 199, originalPrice: 250 },
  instructor: { name: 'Jane Trainer', title: 'Lead Instructor', bio: '15 years in the industry' },
  relatedCourses: ['{{courseId}}'],
  locations: [
    {
      name: 'London Centre',
      schedules: [
        { time: '09:00 - 17:00', startDate: '2027-08-02', endDate: '2027-08-05', price: 220, seatsAvailable: 12 }
      ]
    }
  ],
  status: 'Published',
  isPopular: true,
  icon: 'shield',
  iconColor: 'bg-blue-600'
};

const folder = {
  name: '15. Licences',
  description: 'The SIA-style credentials sold alongside the courses. Reads are public; writes need {{adminToken}}. '
    + 'A licence carries its own venues and dated sessions, so it can be booked through `9. Bookings` exactly like a course — '
    + 'post the licence id as `courseId` and one of its schedule ids as `session.scheduleId`.',
  item: [
    req({
      name: 'List Licences',
      method: 'GET',
      path: '/licenses',
      query: [
        { key: 'category', value: 'SIA Training', description: 'SIA Training | First Aid | Health & Safety | Specialist', disabled: true },
        { key: 'status', value: 'Published', description: 'Published | Draft | Archived (drafts need an admin token)', disabled: true },
        { key: 'search', value: 'door', description: 'matches title, licence number, holder name or type', disabled: true },
        { key: 'page', value: '1', disabled: true },
        { key: 'limit', value: '10', disabled: true }
      ],
      description: 'Paginated (10 per page). The same list comes back under `data` and `licenses`, with `total`, `page` and `limit`. '
        + 'Without an admin token only Published licences are returned.',
      tests: [...okTest('Licences listed'), 'var body = pm.response.json();', 'if (body.data && body.data[0]) { pm.collectionVariables.set("licenseId", body.data[0].id); }']
    }),
    req({
      name: 'Get Licence',
      method: 'GET',
      path: '/licenses/{{licenseId}}',
      description: 'The licence is returned under `data` and also spread at the top level. Here `relatedCourses` carries the '
        + 'full course records rather than just their ids. A draft answers 403 without an admin token.',
      tests: [...okTest(), 'var body = pm.response.json();',
        'if (body.data && body.data.locations && body.data.locations[0] && body.data.locations[0].schedules[0]) {',
        '    pm.collectionVariables.set("licenseScheduleId", body.data.locations[0].schedules[0].id);',
        '}']
    }),
    req({
      name: 'Create Licence',
      method: 'POST',
      path: '/licenses',
      auth: 'adminToken',
      body: samplePayload,
      description: 'Required: title, category, shortDescription, fullDescription, pricing.basePrice. '
        + 'The licence number, holder id and a three-year expiry are generated, and `holderName` defaults to the title. '
        + '`pricingBreakdown[].price` is free text so it prints as written ("£220", "Included").',
      tests: [...okTest('Licence created'), 'var body = pm.response.json();', 'if (body.data && body.data.id) { pm.collectionVariables.set("licenseId", body.data.id); }']
    }),
    req({
      name: 'Update Licence (partial)',
      method: 'PUT',
      path: '/licenses/{{licenseId}}',
      auth: 'adminToken',
      body: { status: 'Draft', pricing: { basePrice: 240 }, renewalInfo: 'Renew within three months of expiry.' },
      description: 'Only the fields sent change. Sending `highlights`, `learningPoints`, `requirements`, `applicationSteps`, '
        + '`pricingBreakdown`, `relatedCourses` or `locations` replaces that block entirely; leaving one out keeps it.',
      tests: okTest('Licence updated')
    }),
    req({
      name: 'Update Licence (replace venues)',
      method: 'PUT',
      path: '/licenses/{{licenseId}}',
      auth: 'adminToken',
      body: { locations: samplePayload.locations },
      tests: okTest('Licence updated')
    }),
    req({
      name: 'Delete Licence',
      method: 'DELETE',
      path: '/licenses/{{licenseId}}',
      auth: 'adminToken',
      description: 'Removes the licence with its lists, steps, fee table, course links, venues and sessions.',
      tests: okTest('Licence deleted')
    }),
    req({
      name: 'Book a Licence Session',
      method: 'POST',
      path: '/bookings',
      body: {
        courseId: '{{licenseId}}',
        session: { scheduleId: '{{licenseScheduleId}}' },
        customerDetails: { firstName: 'Test', lastName: 'Student', email: '{{testEmail}}', phone: '07000000000', dob: '1990-01-01' },
        billingAddress: { postcode: 'SW1A 1AA', line1: '1 Test Street', line2: '', city: 'London' },
        packageName: 'Standard',
        paymentMethod: 'card',
        totalAmount: 220
      },
      description: 'The booking endpoint takes a licence id just as it takes a course id: the booking comes back with '
        + '`courseModel: "License"` and holds a seat on the licence session.',
      tests: okTest('Licence booked')
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
