/**
 * Upserts the Locations and Scheduling folders into postman_collection.json.
 *
 *   npm run postman:locations
 *
 * Owns folders "7. Locations" and "8. Course Scheduling"; every other folder
 * is left untouched. Requires the collection to exist (npm run postman:auth).
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
  { key: 'locationId', value: '1' },
  { key: 'courseLocationId', value: '1' },
  { key: 'courseLocationDateId', value: '1' }
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
const saveId = (variable, pathExpr = 'body.data.id') => [
  'var body = pm.response.json();',
  `if (${pathExpr}) { pm.collectionVariables.set("${variable}", ${pathExpr}); }`
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

const sampleLocation = {
  name: 'London Centre',
  venueName: 'Westminster Training Rooms',
  addressLine1: '1 Test Street',
  addressLine2: 'Floor 2',
  city: 'London',
  postcode: 'SW1A 1AA',
  country: 'United Kingdom',
  mapsUrl: 'https://maps.google.com/?q=SW1A+1AA',
  parking: true,
  parkingNotes: 'Paid street parking outside',
  accessibility: 'Step-free access and a lift to all floors',
  transport: '5 minutes from Westminster station',
  facilities: ['wifi', 'projector', 'toilets', 'disabled_access'],
  mainImage: 'https://res.cloudinary.com/demo/image/upload/sample.jpg',
  gallery: ['https://res.cloudinary.com/demo/image/upload/sample.jpg'],
  localMarketOverview: 'High demand for SIA licensed staff in central London.',
  localVenues: 'Stadiums, bars and event spaces across Westminster.',
  surroundingAreas: 'Victoria, Pimlico, Lambeth',
  status: 'Active'
};

const sampleDates = [
  { startDate: '2026-11-02', endDate: '2026-11-05', startTime: '09:00', endTime: '17:00', availableSeats: 12, timingsType: 'same' },
  {
    startDate: '2026-12-01',
    endDate: '2026-12-04',
    availableSeats: 8,
    timingsType: 'flexible',
    weeklyTimings: {
      monday: { isOff: false, startTime: '09:30', endTime: '16:30' },
      tuesday: { isOff: false, startTime: '09:30', endTime: '16:30' },
      wednesday: { isOff: false, startTime: '09:30', endTime: '16:30' },
      thursday: { isOff: false, startTime: '09:30', endTime: '16:30' },
      friday: { isOff: false, startTime: '09:30', endTime: '15:00' },
      saturday: { isOff: true, startTime: '', endTime: '' },
      sunday: { isOff: true, startTime: '', endTime: '' }
    }
  }
];

const locationsFolder = {
  name: '7. Locations',
  description: 'Training venues. Reads are public; writes need {{adminToken}}. Postcodes are stored upper-case.',
  item: [
    req({
      name: 'List Locations',
      method: 'GET',
      path: '/locations',
      query: [
        { key: 'search', value: 'london', description: 'matches name, city, postcode or venue name', disabled: true },
        { key: 'status', value: 'Active', description: 'Active | Inactive', disabled: true },
        { key: 'page', value: '1', disabled: true },
        { key: 'limit', value: '20', disabled: true }
      ],
      description: 'Paginated (default 20 per page). `linkedCoursesCount` counts active links to published courses.',
      tests: [...okTest('Locations listed'), ...saveId('locationId', 'body.data && body.data[0] && body.data[0].id')]
    }),
    req({ name: 'Get Location', method: 'GET', path: '/locations/{{locationId}}', description: 'Here `linkedCoursesCount` counts every link, whatever its status.', tests: okTest() }),
    req({ name: 'Linked Courses', method: 'GET', path: '/locations/{{locationId}}/courses', description: 'Links of this location, each with a short course summary.', tests: okTest() }),
    req({
      name: 'Create Location',
      method: 'POST',
      path: '/locations',
      auth: 'adminToken',
      body: sampleLocation,
      description: 'Required: name, addressLine1, city, postcode. Facilities: wifi, projector, whiteboard, catering, toilets, disabled_access, prayer_room, air_conditioning.',
      tests: [...okTest('Location created'), ...saveId('locationId')]
    }),
    req({
      name: 'Update Location (partial)',
      method: 'PUT',
      path: '/locations/{{locationId}}',
      auth: 'adminToken',
      body: { transport: 'Two minutes from the Underground', facilities: ['wifi', 'catering'] },
      description: 'Only the fields sent change. Sending `facilities` or `gallery` replaces that list; leaving it out keeps it.',
      tests: okTest('Location updated')
    }),
    req({
      name: 'Toggle Status',
      method: 'PATCH',
      path: '/locations/{{locationId}}/status',
      auth: 'adminToken',
      body: { status: 'Inactive' },
      description: 'Send `{}` to flip the status, or a status to set it. An inactive location cannot be linked to a course.',
      tests: okTest('Status updated')
    })
  ]
};

const schedulingFolder = {
  name: '8. Course Scheduling',
  description: 'A course offered at a location: its price, deposit terms and dated sessions. '
    + 'Seats are reported as availability — `availableSeats` is what is left and `bookedSeats` is always 0.',
  item: [
    req({
      name: 'All Active Links (public feed)',
      method: 'GET',
      path: '/course-locations',
      description: 'Active links of published courses, with the full location, a course summary and the dates. '
        + 'Disabled locations are included so the portal can grey them out — check `locationId.status`.',
      tests: [...okTest('Feed returned'), ...saveId('courseLocationId', 'body.data && body.data[0] && body.data[0].id')]
    }),
    req({
      name: 'Links of a Course',
      method: 'GET',
      path: '/course-locations/course/{{courseId}}',
      query: [{ key: 'activeOnly', value: 'true', description: 'hides inactive links and disabled locations', disabled: true }],
      tests: okTest()
    }),
    req({ name: 'Get Link', method: 'GET', path: '/course-locations/{{courseLocationId}}', tests: okTest() }),
    req({
      name: 'Link Location to Course',
      method: 'POST',
      path: '/course-locations/course/{{courseId}}',
      auth: 'adminToken',
      body: {
        locationId: '{{locationId}}',
        price: 225.5,
        vatIncluded: true,
        depositRequired: true,
        depositAmount: 50,
        whatsIncluded: 'Course manual, exam fee and certificate',
        dates: sampleDates
      },
      description: 'Required: locationId and price. A location can only be linked once per course, and an inactive '
        + 'location is refused. `timingsType: "flexible"` uses `weeklyTimings`; "same" uses startTime/endTime.',
      tests: [...okTest('Location linked'), ...saveId('courseLocationId'), ...saveId('courseLocationDateId', 'body.data && body.data.dates && body.data.dates[0] && body.data.dates[0].id')]
    }),
    req({
      name: 'Update Link and Dates',
      method: 'PUT',
      path: '/course-locations/{{courseLocationId}}',
      auth: 'adminToken',
      body: {
        price: 249,
        whatsIncluded: 'Course manual and exam fee',
        dates: [{ _id: '{{courseLocationDateId}}', startDate: '2026-11-02', endDate: '2026-11-05', availableSeats: 20 }]
      },
      description: 'When `dates` is sent it is the complete set: entries with an `_id` are updated, new entries are '
        + 'added and anything missing is deleted. Omit `dates` to leave the schedule untouched.',
      tests: okTest('Link updated')
    }),
    req({
      name: 'Add Date',
      method: 'POST',
      path: '/course-locations/{{courseLocationId}}/dates',
      auth: 'adminToken',
      body: { startDate: '2027-01-11', endDate: '2027-01-14', startTime: '09:00', endTime: '17:00', availableSeats: 15 },
      description: 'Returns the date with `seatsRemaining` and `availabilityStatus` (Available / Selling Fast / Sold Out).',
      tests: [...okTest('Date added'), ...saveId('courseLocationDateId')]
    }),
    req({
      name: 'Update Date',
      method: 'PUT',
      path: '/course-location-dates/{{courseLocationDateId}}',
      auth: 'adminToken',
      body: { availableSeats: 4, startTime: '10:00' },
      tests: okTest('Date updated')
    }),
    req({ name: 'Delete Date', method: 'DELETE', path: '/course-location-dates/{{courseLocationDateId}}', auth: 'adminToken', tests: okTest('Date removed') }),
    req({
      name: 'Unlink Location',
      method: 'DELETE',
      path: '/course-locations/{{courseLocationId}}',
      auth: 'adminToken',
      description: 'Removes the link and every date under it.',
      tests: okTest('Location removed from course')
    })
  ]
};

for (const v of VARIABLES) {
  if (!data.variable.find(x => x.key === v.key)) data.variable.push({ ...v, type: 'string' });
}
const owned = new Set([locationsFolder.name, schedulingFolder.name]);
data.item = data.item.filter(f => !owned.has(f.name));
data.item.push(locationsFolder, schedulingFolder);
data.item.sort((a, b) => (parseFloat(a.name) || 0) - (parseFloat(b.name) || 0));

fs.writeFileSync(file, JSON.stringify(data, null, 2) + '\n');
console.log(`Updated ${path.basename(file)}: ${data.item.length} folders, ${data.item.reduce((n, f) => n + f.item.length, 0)} requests.`);
