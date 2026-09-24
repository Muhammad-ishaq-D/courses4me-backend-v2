/**
 * HTTP-level tests for the blog: what a visitor may see, the shape the
 * article page consumes, and the admin's create/update/delete.
 */
const request = require('supertest');
const { createMockDb, tokenFor } = require('./helpers/mockDb');

const mockDb = createMockDb({
  users: [
    { id: 1, name: 'Site Admin', email: 'admin@courses4me.test', password: 'Adm1n!Pass', role: 'admin' },
    { id: 2, name: 'Cathy Customer', email: 'cathy@example.test', password: 'Cust0mer!Pass', role: 'customer' }
  ],
  blogs: [
    {
      id: 1,
      slug: 'how-to-become-a-door-supervisor',
      title: 'How to Become a Door Supervisor',
      excerpt: 'Everything you need to know about the SIA licence.',
      category: 'Career Guide',
      author_name: 'Sarah Mitchell',
      author_role: 'Senior Training Manager',
      publish_date: 'Feb 28, 2026',
      read_time: '8 min read',
      featured: 1,
      status: 'Published',
      published_at: '2026-02-28T00:00:00Z',
      content: [
        { type: 'paragraph', text: 'Becoming a door supervisor is rewarding.' },
        { type: 'heading', text: 'Training Requirements' },
        { type: 'list', items: ['Conflict management', 'Physical intervention'] }
      ]
    },
    {
      id: 2,
      slug: 'sia-licence-changes',
      title: 'SIA Licence Changes',
      category: 'Industry News',
      status: 'Published',
      published_at: '2026-02-01T00:00:00Z',
      content: [{ type: 'paragraph', text: 'What is changing this year.' }]
    },
    {
      id: 3,
      slug: 'unfinished-draft',
      title: 'Unfinished Draft',
      category: 'Training',
      status: 'Draft',
      content: []
    }
  ]
});

jest.mock('../src/config/db', () => mockDb);
jest.mock('../src/utils/sendEmail', () => jest.fn(async () => ({})));
jest.mock('../src/middlewares/uploadMiddleware', () => ({ fields: () => (req, res, next) => next() }));
jest.mock('../src/config/cloudinary', () => ({
  uploader: { upload: jest.fn(async () => ({ secure_url: 'https://cdn.test/cover.jpg' })) }
}));

const app = require('../src/app');
const cloudinary = require('../src/config/cloudinary');

const asAdmin = () => `Bearer ${tokenFor(mockDb.findUser('admin@courses4me.test'))}`;
const asCustomer = () => `Bearer ${tokenFor(mockDb.findUser('cathy@example.test'))}`;

describe('GET /api/blogs', () => {
  it('gives a visitor the published articles, feature first, with category counts', async () => {
    const res = await request(app).get('/api/blogs');

    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    expect(res.body.data).toHaveLength(2); // the draft is not among them
    expect(res.body.data[0].slug).toBe('how-to-become-a-door-supervisor');
    expect(res.body.data[0].featured).toBe(true);
    expect(res.body.categories).toMatchObject({ 'Career Guide': 1, 'Industry News': 1 });
    // The list is also under `blogs`, as the portal reads it
    expect(res.body.blogs).toEqual(res.body.data);
  });

  it('never shows a draft to a visitor, even when asked for one', async () => {
    const res = await request(app).get('/api/blogs').query({ status: 'Draft' });

    expect(res.status).toBe(200);
    expect(res.body.data.every(b => b.status === 'Published')).toBe(true);
  });

  it('shows the admin everything, including drafts', async () => {
    const res = await request(app).get('/api/blogs').set('Authorization', asAdmin());

    expect(res.status).toBe(200);
    expect(res.body.data).toHaveLength(3);
    expect(res.body.data.some(b => b.status === 'Draft')).toBe(true);
  });

  it('filters by category and by search', async () => {
    const byCategory = await request(app).get('/api/blogs').query({ category: 'Industry News' });
    expect(byCategory.body.data).toHaveLength(1);
    expect(byCategory.body.data[0].slug).toBe('sia-licence-changes');

    const bySearch = await request(app).get('/api/blogs').query({ search: 'door supervisor' });
    expect(bySearch.body.data).toHaveLength(1);
    expect(bySearch.body.data[0].id).toBe(1);
  });

  it('rejects a category it does not publish', async () => {
    const res = await request(app).get('/api/blogs').query({ category: 'Gardening' });
    expect(res.status).toBe(400);
  });
});

describe('GET /api/blogs/:id', () => {
  it('returns the article by id, with its body in the order it was written', async () => {
    const res = await request(app).get('/api/blogs/1');

    expect(res.status).toBe(200);
    expect(res.body.data.title).toBe('How to Become a Door Supervisor');
    expect(res.body.data.author).toBe('Sarah Mitchell');
    expect(res.body.data.role).toBe('Senior Training Manager');
    expect(res.body.data.content).toEqual([
      { type: 'paragraph', text: 'Becoming a door supervisor is rewarding.' },
      { type: 'heading', text: 'Training Requirements' },
      { type: 'list', items: ['Conflict management', 'Physical intervention'] }
    ]);
    // `id` stays a number so the portal's /blog/:id links keep working
    expect(typeof res.body.data.id).toBe('number');
    expect(typeof res.body.data._id).toBe('string');
  });

  it('returns the same article by slug', async () => {
    const res = await request(app).get('/api/blogs/how-to-become-a-door-supervisor');

    expect(res.status).toBe(200);
    expect(res.body.data.id).toBe(1);
  });

  it('hides a draft from a visitor but shows it to an admin', async () => {
    expect((await request(app).get('/api/blogs/3')).status).toBe(404);
    expect((await request(app).get('/api/blogs/3').set('Authorization', asAdmin())).status).toBe(200);
  });

  it('counts a visitor read', async () => {
    const before = mockDb.state.blogs.find(b => b.id === 2).views;
    await request(app).get('/api/blogs/2');
    expect(mockDb.state.blogs.find(b => b.id === 2).views).toBe(before + 1);
  });
});

describe('writing articles', () => {
  it('refuses a customer and an anonymous caller', async () => {
    expect((await request(app).post('/api/blogs').send({ title: 'Nope' })).status).toBe(401);
    expect((await request(app).post('/api/blogs').set('Authorization', asCustomer()).send({ title: 'Nope' })).status).toBe(403);
  });

  it('creates an article, deriving the slug and uploading a pasted cover', async () => {
    const res = await request(app).post('/api/blogs').set('Authorization', asAdmin()).send({
      title: 'Working as a CCTV Operator',
      excerpt: 'What the role involves.',
      category: 'Career Guide',
      author: 'David Okonkwo',
      role: 'Security Training Specialist',
      image: 'data:image/png;base64,iVBORw0KGgo=',
      status: 'Published',
      content: [
        { type: 'paragraph', text: 'Control rooms are busy places.' },
        { type: 'numberedList', items: ['Apply', 'Train', 'Qualify'] }
      ]
    });

    expect(res.status).toBe(201);
    expect(res.body.data.slug).toBe('working-as-a-cctv-operator');
    expect(res.body.data.image).toBe('https://cdn.test/cover.jpg');
    expect(cloudinary.uploader.upload).toHaveBeenCalled();
    expect(res.body.data.content).toHaveLength(2);
    expect(res.body.data.content[1]).toEqual({ type: 'numberedList', items: ['Apply', 'Train', 'Qualify'] });
    // Publishing stamps the moment it went live
    expect(res.body.data.publishedAt).toBeTruthy();
  });

  it('gives a second article with the same title its own slug', async () => {
    const res = await request(app).post('/api/blogs').set('Authorization', asAdmin())
      .send({ title: 'SIA Licence Changes', category: 'Industry News' });

    expect(res.status).toBe(201);
    expect(res.body.data.slug).toBe('sia-licence-changes-2');
  });

  it('rejects a list block carrying text, and a text block carrying items', async () => {
    const badList = await request(app).post('/api/blogs').set('Authorization', asAdmin())
      .send({ title: 'Bad Blocks One', content: [{ type: 'list', text: 'should be items' }] });
    expect(badList.status).toBe(400);

    const badText = await request(app).post('/api/blogs').set('Authorization', asAdmin())
      .send({ title: 'Bad Blocks Two', content: [{ type: 'paragraph', items: ['should be text'] }] });
    expect(badText.status).toBe(400);
  });

  it('updates the body only when one was sent', async () => {
    const renamed = await request(app).put('/api/blogs/2').set('Authorization', asAdmin())
      .send({ title: 'SIA Licence Changes 2026' });

    expect(renamed.status).toBe(200);
    expect(renamed.body.data.title).toBe('SIA Licence Changes 2026');
    expect(renamed.body.data.content).toHaveLength(1); // body untouched

    const rewritten = await request(app).put('/api/blogs/2').set('Authorization', asAdmin())
      .send({ content: [{ type: 'heading', text: 'What changed' }, { type: 'paragraph', text: 'Quite a lot.' }] });

    expect(rewritten.body.data.content).toHaveLength(2);
    expect(rewritten.body.data.content[0]).toEqual({ type: 'heading', text: 'What changed' });
  });

  it('404s for an article that is not there', async () => {
    expect((await request(app).put('/api/blogs/9999').set('Authorization', asAdmin()).send({ title: 'Ghost' })).status).toBe(404);
    expect((await request(app).delete('/api/blogs/9999').set('Authorization', asAdmin())).status).toBe(404);
  });

  it('deletes an article and takes its body with it', async () => {
    const created = await request(app).post('/api/blogs').set('Authorization', asAdmin())
      .send({ title: 'Temporary Article', content: [{ type: 'list', items: ['one', 'two'] }] });
    const id = created.body.data.id;
    const blockIds = mockDb.state.blogBlocks.filter(b => b.blog_id === id).map(b => b.id);
    expect(blockIds.length).toBe(1);

    const res = await request(app).delete(`/api/blogs/${id}`).set('Authorization', asAdmin());

    expect(res.status).toBe(200);
    expect(mockDb.state.blogs.some(b => b.id === id)).toBe(false);
    expect(mockDb.state.blogBlocks.some(b => b.blog_id === id)).toBe(false);
    expect(mockDb.state.blogBlockItems.some(i => blockIds.includes(i.blog_block_id))).toBe(false);
  });

  it('deletes several at once', async () => {
    const a = (await request(app).post('/api/blogs').set('Authorization', asAdmin()).send({ title: 'Bulk One' })).body.data.id;
    const b = (await request(app).post('/api/blogs').set('Authorization', asAdmin()).send({ title: 'Bulk Two' })).body.data.id;

    const res = await request(app).delete('/api/blogs').set('Authorization', asAdmin()).send({ ids: [a, b] });

    expect(res.status).toBe(200);
    expect(res.body.deleted).toBe(2);
    expect(mockDb.state.blogs.some(x => x.id === a || x.id === b)).toBe(false);
  });
});
