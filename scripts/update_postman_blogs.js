/**
 * Upserts the Blog folder into postman_collection.json.
 *
 *   npm run postman:blogs
 *
 * Owns folder "18. Blog"; every other folder is left untouched.
 */
const fs = require('fs');
const path = require('path');

const file = path.join(__dirname, '..', 'postman_collection.json');
if (!fs.existsSync(file)) {
  console.error('postman_collection.json not found — run `npm run postman:auth` first.');
  process.exit(1);
}
const data = JSON.parse(fs.readFileSync(file, 'utf8'));

const url = (p, query) => ({
  raw: `{{baseUrl}}${p}${query ? `?${query.map(q => `${q.key}=${q.value}`).join('&')}` : ''}`,
  host: ['{{baseUrl}}'],
  path: p.replace(/^\//, '').split('/'),
  ...(query ? { query } : {})
});
const json = (body) => ({ mode: 'raw', raw: JSON.stringify(body, null, 2), options: { raw: { language: 'json' } } });
const test = (lines) => [{ listen: 'test', script: { type: 'text/javascript', exec: lines } }];
const okTest = (label = 'Request succeeded') => [
  `pm.test("${label}", function () {`,
  '    pm.expect(pm.response.code).to.be.oneOf([200, 201]);',
  '    pm.expect(pm.response.json().success).to.eql(true);',
  '});'
];

const sampleBody = [
  { type: 'paragraph', text: 'Becoming a door supervisor is one of the most accessible careers in UK security.' },
  { type: 'heading', text: 'Training Requirements' },
  { type: 'paragraph', text: 'You need an SIA-approved Level 2 Award, which covers:' },
  { type: 'list', items: ['Conflict management', 'Physical intervention', 'Working in the private security industry'] },
  { type: 'subheading', text: 'How long it takes' },
  { type: 'numberedList', items: ['Book the course', 'Sit the assessments', 'Apply for the licence'] }
];

const folder = {
  name: '18. Blog',
  description: 'Articles for the blog. Reading is public and only ever returns published articles; an admin token '
    + 'additionally sees drafts. The body is a list of typed blocks — paragraph, heading, subheading, quote, and '
    + 'list / numberedList which carry `items` instead of `text` — rendered in the order given.',
  item: [
    {
      name: 'List Articles',
      request: {
        method: 'GET',
        url: url('/blogs', [
          { key: 'category', value: 'Career Guide' },
          { key: 'search', value: '' },
          { key: 'page', value: '1' },
          { key: 'limit', value: '10' }
        ]),
        description: 'Published articles, the featured one first, then newest first. Every parameter is optional. '
          + 'The response also carries `categories`, the count of published articles per category, for the filter bar. '
          + 'Categories: Career Guide, Industry News, Study Tips, Company News, Training, Technology.'
      },
      event: test(okTest())
    },
    {
      name: 'List Articles (admin, drafts included)',
      request: {
        method: 'GET',
        header: [{ key: 'Authorization', value: 'Bearer {{token}}' }],
        url: url('/blogs', [{ key: 'status', value: 'Draft' }]),
        description: 'With an admin token, `status` is honoured and drafts are returned. Without one, the filter is '
          + 'ignored and only published articles come back.'
      },
      event: test(okTest())
    },
    {
      name: 'Get One Article',
      request: {
        method: 'GET',
        url: url('/blogs/{{blogId}}'),
        description: 'Accepts the numeric id or the slug, so /blogs/1 and /blogs/how-to-become-a-door-supervisor-2026 '
          + 'are the same article. Returns the body under `content`, and counts a read. A draft answers 404 unless the '
          + 'caller is an admin.'
      },
      event: test(okTest())
    },
    {
      name: 'Create Article',
      request: {
        method: 'POST',
        header: [{ key: 'Content-Type', value: 'application/json' }, { key: 'Authorization', value: 'Bearer {{token}}' }],
        url: url('/blogs'),
        body: json({
          title: 'How to Become a Door Supervisor in 2026',
          excerpt: 'Everything you need to know about getting your SIA Door Supervisor licence.',
          category: 'Career Guide',
          author: 'Sarah Mitchell',
          role: 'Senior Training Manager',
          image: 'https://res.cloudinary.com/demo/image/upload/sample.jpg',
          publishDate: 'Feb 28, 2026',
          readTime: '8 min read',
          featured: false,
          status: 'Published',
          content: sampleBody
        }),
        description: 'Admin only. `title` is the only required field. The slug is made from the title when one is not '
          + 'given, and a clash gets a number appended. `image` may be a URL or a base64 data URI — a data URI is '
          + 'uploaded and the article stores the URL. Setting `status` to Published stamps `publishedAt`.'
      },
      event: test(okTest('Article created'))
    },
    {
      name: 'Update Article',
      request: {
        method: 'PUT',
        header: [{ key: 'Content-Type', value: 'application/json' }, { key: 'Authorization', value: 'Bearer {{token}}' }],
        url: url('/blogs/{{blogId}}'),
        body: json({ title: 'How to Become a Door Supervisor in 2026', status: 'Published', featured: true }),
        description: 'Admin only, and partial: only the fields sent are changed. The body is replaced only when '
          + '`content` is included, so renaming an article never empties it.'
      },
      event: test(okTest('Article updated'))
    },
    {
      name: 'Delete Article',
      request: {
        method: 'DELETE',
        header: [{ key: 'Authorization', value: 'Bearer {{token}}' }],
        url: url('/blogs/{{blogId}}'),
        description: 'Admin only. The body blocks and their list items go with it.'
      },
      event: test(okTest('Article deleted'))
    },
    {
      name: 'Delete Several Articles',
      request: {
        method: 'DELETE',
        header: [{ key: 'Content-Type', value: 'application/json' }, { key: 'Authorization', value: 'Bearer {{token}}' }],
        url: url('/blogs'),
        body: json({ ids: [1, 2] }),
        description: 'Admin only. Returns `deleted`, how many rows went.'
      },
      event: test(okTest('Articles deleted'))
    }
  ]
};

data.item = data.item.filter(f => f.name !== folder.name);
data.item.push(folder);
data.item.sort((a, b) => (parseFloat(a.name) || 0) - (parseFloat(b.name) || 0));

// A blogId to try the keyed requests against.
data.variable = data.variable || [];
if (!data.variable.some(v => v.key === 'blogId')) {
  data.variable.push({ key: 'blogId', value: '1', type: 'string' });
}

fs.writeFileSync(file, JSON.stringify(data, null, 2) + '\n');
console.log(`Updated ${path.basename(file)}: ${data.item.length} folders, ${data.item.reduce((n, f) => n + f.item.length, 0)} requests.`);
