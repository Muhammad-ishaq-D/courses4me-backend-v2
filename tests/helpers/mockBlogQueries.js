/**
 * The blog half of the in-memory database: articles and the blocks their
 * body is built from.
 *
 * Returns undefined for anything it does not recognise, so the caller can
 * carry on down its own chain.
 */
function createBlogRouter({ state, nextId, now }) {
  const LIST_TYPES = ['list', 'numberedList'];

  function seedBlog(b) {
    const id = b.id || nextId('blogs');
    state.seq.blogs = Math.max(state.seq.blogs, id);
    const { content, ...rest } = b;
    state.blogs.push({
      id,
      slug: b.slug || `article-${id}`,
      title: b.title || 'Test Article',
      excerpt: b.excerpt ?? '',
      category: b.category || 'Career Guide',
      cover_image: b.cover_image ?? null,
      author_name: b.author_name ?? 'Test Author',
      author_role: b.author_role ?? 'Writer',
      author_avatar: b.author_avatar ?? null,
      publish_date: b.publish_date ?? 'Jan 1, 2026',
      read_time: b.read_time ?? '5 min read',
      featured: b.featured ?? 0,
      status: b.status || 'Published',
      published_at: b.published_at ? new Date(b.published_at) : now(),
      views: b.views ?? 0,
      legacy_id: b.legacy_id ?? null,
      created_at: b.created_at ? new Date(b.created_at) : now(),
      updated_at: now(),
      ...rest,
      id
    });
    (content || []).forEach((block, position) => writeBlock(id, block, position));
    return id;
  }

  function writeBlock(blogId, block, position) {
    const blockId = nextId('blogBlocks');
    state.blogBlocks.push({
      id: blockId,
      blog_id: blogId,
      position,
      type: block.type,
      text: LIST_TYPES.includes(block.type) ? null : (block.text ?? '')
    });
    if (!LIST_TYPES.includes(block.type)) return;
    (block.items || []).forEach((value, index) => {
      state.blogBlockItems.push({ id: nextId('blogBlockItems'), blog_block_id: blockId, position: index, value });
    });
  }

  /** Applies the WHERE clauses findAll builds, in the order it builds them. */
  function filtered(q, params) {
    let rows = [...state.blogs];
    let i = 0;
    if (/status = \?/.test(q)) { const s = params[i++]; rows = rows.filter(b => b.status === s); }
    if (/category = \?/.test(q)) { const c = params[i++]; rows = rows.filter(b => b.category === c); }
    if (/featured = \?/.test(q)) { const f = params[i++]; rows = rows.filter(b => (b.featured ? 1 : 0) === Number(f)); }
    if (/title LIKE \?/.test(q)) {
      const needle = String(params[i++]).replace(/%/g, '').toLowerCase();
      i++; // the excerpt copy of the same value
      rows = rows.filter(b => `${b.title} ${b.excerpt}`.toLowerCase().includes(needle));
    }
    return { rows, next: i };
  }

  return {
    seedBlog,

    route(q, params) {
      // ── reads ──────────────────────────────────────────────────────────
      if (/^SELECT COUNT\(\*\) AS total FROM blogs/.test(q)) {
        return [{ total: filtered(q, params).rows.length }];
      }

      if (/FROM blogs WHERE category = 'x'/.test(q)) return [];

      if (/SELECT category, COUNT\(\*\) AS total FROM blogs WHERE status = 'Published' GROUP BY category/.test(q)) {
        const counts = {};
        for (const b of state.blogs.filter(x => x.status === 'Published')) {
          counts[b.category] = (counts[b.category] || 0) + 1;
        }
        return Object.entries(counts).map(([category, total]) => ({ category, total }));
      }

      if (/^SELECT slug FROM blogs WHERE \(slug = \? OR slug LIKE \?\)/.test(q)) {
        const root = params[0];
        const except = /id <> \?/.test(q) ? Number(params[2]) : null;
        return state.blogs
          .filter(b => (b.slug === root || b.slug.startsWith(`${root}-`)) && b.id !== except)
          .map(b => ({ slug: b.slug }));
      }

      if (/FROM blogs WHERE legacy_id = \? LIMIT 1/.test(q)) {
        const b = state.blogs.find(x => x.legacy_id === params[0]);
        return b ? [{ id: b.id }] : [];
      }

      if (/^SELECT .* FROM blogs WHERE (id|slug) = \?/.test(q)) {
        const bySlug = /WHERE slug = \?/.test(q);
        const wantStatus = /AND status = \?/.test(q) ? params[1] : null;
        const b = state.blogs.find(x => (bySlug ? x.slug === params[0] : x.id === Number(params[0])));
        if (!b) return [];
        if (wantStatus && b.status !== wantStatus) return [];
        return [{ ...b }];
      }

      if (/FROM blogs/.test(q) && /ORDER BY featured DESC/.test(q)) {
        const { rows, next } = filtered(q, params);
        const ordered = rows.sort((a, b) =>
          (b.featured ? 1 : 0) - (a.featured ? 1 : 0) ||
          new Date(b.published_at || b.created_at) - new Date(a.published_at || a.created_at) ||
          b.id - a.id);
        let out = ordered;
        if (/LIMIT \?/.test(q)) {
          const limit = Number(params[next]);
          const offset = /OFFSET \?/.test(q) ? Number(params[next + 1]) : 0;
          out = ordered.slice(offset, offset + limit);
        }
        return out.map(b => ({ ...b }));
      }

      if (/FROM blog_blocks WHERE blog_id IN \(\?\)/.test(q)) {
        const ids = params[0].map(Number);
        return state.blogBlocks
          .filter(b => ids.includes(b.blog_id))
          .sort((a, b) => a.blog_id - b.blog_id || a.position - b.position || a.id - b.id)
          .map(b => ({ ...b }));
      }

      if (/FROM blog_block_items WHERE blog_block_id IN \(\?\)/.test(q)) {
        const ids = params[0].map(Number);
        return state.blogBlockItems
          .filter(i => ids.includes(i.blog_block_id))
          .sort((a, b) => a.blog_block_id - b.blog_block_id || a.position - b.position || a.id - b.id)
          .map(i => ({ blog_block_id: i.blog_block_id, value: i.value }));
      }

      // ── writes ─────────────────────────────────────────────────────────
      if (/^INSERT INTO blogs /.test(q)) {
        const cols = q.match(/^INSERT INTO blogs \(([^)]+)\)/)[1].split(',').map(c => c.trim());
        const row = {};
        cols.forEach((c, i) => { row[c] = params[i]; });
        const id = seedBlog({ ...row, content: [] });
        return { insertId: id, affectedRows: 1 };
      }

      // Ahead of the general case below, which would otherwise read
      // "views = views + 1" as a column assignment.
      if (/^UPDATE blogs SET views = views \+ 1/.test(q)) {
        const blog = state.blogs.find(b => b.id === Number(params[0]));
        if (blog) blog.views += 1;
        return { affectedRows: blog ? 1 : 0 };
      }

      if (/^UPDATE blogs SET /.test(q)) {
        const cols = q.match(/^UPDATE blogs SET (.*) WHERE id = \?$/)[1].split(',').map(c => c.trim().split(' = ')[0]);
        const id = Number(params[params.length - 1]);
        const blog = state.blogs.find(b => b.id === id);
        if (!blog) return { affectedRows: 0 };
        cols.forEach((c, i) => { blog[c] = params[i]; });
        blog.updated_at = now();
        return { affectedRows: 1 };
      }

      if (/^DELETE FROM blogs WHERE id IN \(\?\)/.test(q)) {
        const ids = params[0].map(Number);
        const before = state.blogs.length;
        state.blogs = state.blogs.filter(b => !ids.includes(b.id));
        cascade(ids);
        return { affectedRows: before - state.blogs.length };
      }

      if (/^DELETE FROM blogs WHERE id = \?/.test(q)) {
        const id = Number(params[0]);
        const before = state.blogs.length;
        state.blogs = state.blogs.filter(b => b.id !== id);
        cascade([id]);
        return { affectedRows: before - state.blogs.length };
      }

      if (/^DELETE FROM blog_blocks WHERE blog_id = \?/.test(q)) {
        cascade([Number(params[0])]);
        return { affectedRows: 1 };
      }

      if (/^INSERT INTO blog_blocks /.test(q)) {
        const [blog_id, position, type, text] = params;
        const id = nextId('blogBlocks');
        state.blogBlocks.push({ id, blog_id: Number(blog_id), position, type, text });
        return { insertId: id, affectedRows: 1 };
      }

      if (/^INSERT INTO blog_block_items /.test(q)) {
        for (let i = 0; i < params.length; i += 3) {
          state.blogBlockItems.push({
            id: nextId('blogBlockItems'),
            blog_block_id: Number(params[i]),
            position: params[i + 1],
            value: params[i + 2]
          });
        }
        return { affectedRows: params.length / 3 };
      }

      return undefined;
    }
  };

  function cascade(blogIds) {
    const blockIds = state.blogBlocks.filter(b => blogIds.includes(b.blog_id)).map(b => b.id);
    state.blogBlocks = state.blogBlocks.filter(b => !blogIds.includes(b.blog_id));
    state.blogBlockItems = state.blogBlockItems.filter(i => !blockIds.includes(i.blog_block_id));
  }
}

module.exports = { createBlogRouter };
