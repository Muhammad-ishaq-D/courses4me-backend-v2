/**
 * Upserts the Reviews folder into postman_collection.json.
 *
 *   npm run postman:reviews
 *
 * Owns folder "17. Reviews"; every other folder is left untouched.
 */
const fs = require('fs');
const path = require('path');

const file = path.join(__dirname, '..', 'postman_collection.json');
if (!fs.existsSync(file)) {
  console.error('postman_collection.json not found — run `npm run postman:auth` first.');
  process.exit(1);
}
const data = JSON.parse(fs.readFileSync(file, 'utf8'));

const url = (p) => ({ raw: `{{baseUrl}}${p}`, host: ['{{baseUrl}}'], path: p.replace(/^\//, '').split('/') });
const json = (body) => ({ mode: 'raw', raw: JSON.stringify(body, null, 2), options: { raw: { language: 'json' } } });
const test = (lines) => [{ listen: 'test', script: { type: 'text/javascript', exec: lines } }];
const okTest = (label = 'Request succeeded') => [
  `pm.test("${label}", function () {`,
  '    pm.expect(pm.response.code).to.be.oneOf([200, 201]);',
  '    pm.expect(pm.response.json().success).to.eql(true);',
  '});'
];

const folder = {
  name: '17. Reviews',
  description: 'Course reviews left by customers. A review can only be left for a booking the signed-in customer '
    + 'has paid for, and there is one review per customer per course — submitting again updates it.',
  item: [
    {
      name: 'Leave or Update a Review',
      request: {
        method: 'POST',
        header: [{ key: 'Content-Type', value: 'application/json' }, { key: 'Authorization', value: 'Bearer {{token}}' }],
        url: url('/reviews'),
        body: json({ bookingId: '{{bookingId}}', rating: 5, comment: 'Excellent trainer and venue.' }),
        description: 'Rating is a whole number from 1 to 5, comment is optional (1000 characters). '
          + 'Answers 201 for a new review and 200 when it replaced an earlier one, and 403 when the booking is not '
          + "the caller's or has not been paid for. The admins are notified the first time only."
      },
      event: test(okTest('Review saved'))
    },
    {
      name: 'My Reviews',
      request: {
        method: 'GET',
        header: [{ key: 'Authorization', value: 'Bearer {{token}}' }],
        url: url('/reviews/my'),
        description: 'Every review the signed-in customer has left, newest first.'
      },
      event: test(okTest())
    }
  ]
};

data.item = data.item.filter(f => f.name !== folder.name);
data.item.push(folder);
data.item.sort((a, b) => (parseFloat(a.name) || 0) - (parseFloat(b.name) || 0));

fs.writeFileSync(file, JSON.stringify(data, null, 2) + '\n');
console.log(`Updated ${path.basename(file)}: ${data.item.length} folders, ${data.item.reduce((n, f) => n + f.item.length, 0)} requests.`);
