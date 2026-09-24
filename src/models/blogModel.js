const db = require('../config/db');

/**
 * Articles and the blocks their body is built from.
 *
 * A row becomes the shape the article page already expects: the author fields
 * are nested under `author`, and the blocks come back as `content`, the list
 * of `{ type, text }` / `{ type, items }` objects the renderer walks.
 */

const COLUMNS = {
  slug: 'slug',
  title: 'title',
  excerpt: 'excerpt',
  category: 'category',
  coverImage: 'cover_image',
  image: 'cover_image',
  authorName: 'author_name',
  authorRole: 'author_role',
  authorAvatar: 'author_avatar',
  publishDate: 'publish_date',
  readTime: 'read_time',
  featured: 'featured',
  status: 'status',
  publishedAt: 'published_at',
  legacyId: 'legacy_id'
};

const NOT_NULL_TEXT = ['excerpt', 'author_name', 'author_role', 'publish_date', 'read_time'];
const LIST_TYPES = ['list', 'numberedList'];

const SELECT = 'id, slug, title, excerpt, category, cover_image, author_name, author_role, author_avatar, ' +
  'publish_date, read_time, featured, status, published_at, views, created_at, updated_at';

const emptyToNull = (v) => (v === '' ? null : v);
const toDateTime = (v) => {
  if (v === null || v === undefined || v === '') return null;
  const d = v instanceof Date ? v : new Date(v);
  return Number.isNaN(d.getTime()) ? null : d;
};

/**
 * A URL-safe slug. Two articles may share a title, so the caller makes it
 * unique; this only settles on the characters.
 */
function slugify(value) {
  return String(value || '')
    .toLowerCase()
    .normalize('NFKD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 190) || 'article';
}

/** The date as the article displays it, when the author did not write one. */
const displayDate = (date) => new Date(date).toLocaleDateString('en-GB', {
  day: 'numeric', month: 'short', year: 'numeric', timeZone: 'UTC'
});

/** Flattens the API payload into `blogs` columns; only known keys are written. */
function toColumns(data) {
  const out = {};
  for (const [key, value] of Object.entries(data || {})) {
    if (value === undefined) continue;
    const col = COLUMNS[key];
    if (!col) continue;
    out[col] = NOT_NULL_TEXT.includes(col) ? (value ?? '') : emptyToNull(value);
  }

  if (data && data.author && typeof data.author === 'object') {
    if (data.author.name !== undefined) out.author_name = data.author.name ?? '';
    if (data.author.role !== undefined) out.author_role = data.author.role ?? '';
    if (data.author.avatar !== undefined) out.author_avatar = emptyToNull(data.author.avatar);
  }

  if (out.featured !== undefined && out.featured !== null) {
    out.featured = out.featured === true || out.featured === 'true' || out.featured === 1 || out.featured === '1' ? 1 : 0;
  }
  if (out.published_at !== undefined) out.published_at = toDateTime(out.published_at);
  return out;
}

/** The row as the blog pages consume it. */
function toPublic(row, content = []) {
  if (!row) return null;
  return {
    id: row.id,
    _id: String(row.id),
    slug: row.slug,
    title: row.title,
    excerpt: row.excerpt || '',
    category: row.category,
    image: row.cover_image || '',
    coverImage: row.cover_image || '',
    author: row.author_name || '',
    role: row.author_role || '',
    authorAvatar: row.author_avatar || '',
    publishDate: row.publish_date || '',
    readTime: row.read_time || '',
    featured: !!row.featured,
    status: row.status,
    publishedAt: row.published_at,
    views: Number(row.views || 0),
    content,
    createdAt: row.created_at,
    updatedAt: row.updated_at
  };
}

/** Writes the body blocks of one article, replacing whatever was there. */
async function saveBlocks(trx, blogId, content) {
  await trx.query('DELETE FROM blog_blocks WHERE blog_id = ?', [blogId]);
  if (!Array.isArray(content) || !content.length) return;

  for (const [position, block] of content.entries()) {
    const type = block && block.type;
    if (!type) continue;

    const { insertId } = await trx.query(
      'INSERT INTO blog_blocks (blog_id, position, type, text) VALUES (?, ?, ?, ?)',
      [blogId, position, type, LIST_TYPES.includes(type) ? null : (block.text ?? '')]
    );

    if (!LIST_TYPES.includes(type)) continue;
    const items = (Array.isArray(block.items) ? block.items : []).filter(i => i !== null && i !== undefined && i !== '');
    if (!items.length) continue;

    const values = [];
    for (const [index, item] of items.entries()) values.push(insertId, index, String(item).slice(0, 1000));
    await trx.query(
      `INSERT INTO blog_block_items (blog_block_id, position, value) VALUES ${items.map(() => '(?, ?, ?)').join(', ')}`,
      values
    );
  }
}

const BlogModel = {
  slugify,
  toPublic,

  /** Makes `base` unique among the slugs already in use. */
  async uniqueSlug(base, exceptId = null) {
    const root = slugify(base);
    const rows = await db.query(
      `SELECT slug FROM blogs WHERE (slug = ? OR slug LIKE ?)${exceptId ? ' AND id <> ?' : ''}`,
      exceptId ? [root, `${root}-%`, exceptId] : [root, `${root}-%`]
    );
    const taken = new Set(rows.map(r => r.slug));
    if (!taken.has(root)) return root;
    for (let n = 2; n < 500; n++) {
      if (!taken.has(`${root}-${n}`)) return `${root}-${n}`;
    }
    return `${root}-${Date.now().toString(36)}`;
  },

  /** The body blocks of one or many articles: { [blogId]: [block] } */
  async contentFor(blogIds) {
    const map = {};
    if (!blogIds.length) return map;

    const blocks = await db.query(
      'SELECT id, blog_id, type, text FROM blog_blocks WHERE blog_id IN (?) ORDER BY blog_id, position, id',
      [blogIds]
    );
    if (!blocks.length) return map;

    const listBlocks = blocks.filter(b => LIST_TYPES.includes(b.type));
    const itemsByBlock = {};
    if (listBlocks.length) {
      const items = await db.query(
        'SELECT blog_block_id, value FROM blog_block_items WHERE blog_block_id IN (?) ORDER BY blog_block_id, position, id',
        [listBlocks.map(b => b.id)]
      );
      for (const item of items) (itemsByBlock[item.blog_block_id] ||= []).push(item.value);
    }

    for (const block of blocks) {
      const shaped = LIST_TYPES.includes(block.type)
        ? { type: block.type, items: itemsByBlock[block.id] || [] }
        : { type: block.type, text: block.text || '' };
      (map[block.blog_id] ||= []).push(shaped);
    }
    return map;
  },

  /**
   * The article list. `status` is forced to Published for visitors; the admin
   * screens pass their own filter.
   */
  async findAll({ status, category, search, featured, limit, offset, withContent = false } = {}) {
    const where = [];
    const params = [];

    if (status) { where.push('status = ?'); params.push(status); }
    if (category && category !== 'All') { where.push('category = ?'); params.push(category); }
    if (featured !== undefined) { where.push('featured = ?'); params.push(featured ? 1 : 0); }
    if (search) {
      where.push('(title LIKE ? OR excerpt LIKE ?)');
      params.push(`%${search}%`, `%${search}%`);
    }

    const sql = where.length ? ` WHERE ${where.join(' AND ')}` : '';
    const [count] = await db.query(`SELECT COUNT(*) AS total FROM blogs${sql}`, params);

    const page = [...params];
    let limits = '';
    if (limit) {
      limits = ' LIMIT ?';
      page.push(limit);
      if (offset) { limits += ' OFFSET ?'; page.push(offset); }
    }

    const rows = await db.query(
      `SELECT ${SELECT} FROM blogs${sql} ORDER BY featured DESC, COALESCE(published_at, created_at) DESC, id DESC${limits}`,
      page
    );

    const content = withContent ? await BlogModel.contentFor(rows.map(r => r.id)) : {};
    return {
      total: Number(count.total),
      rows: rows.map(r => toPublic(r, content[r.id] || []))
    };
  },

  /** How many published articles each category holds, for the filter bar. */
  async categoryCounts() {
    const rows = await db.query(
      "SELECT category, COUNT(*) AS total FROM blogs WHERE status = 'Published' GROUP BY category"
    );
    return rows.reduce((acc, r) => ({ ...acc, [r.category]: Number(r.total) }), {});
  },

  /** One article by its key, with its body. `key` is an id or a slug. */
  async findOne(key, { status } = {}) {
    const byId = /^\d+$/.test(String(key));
    const where = byId ? 'id = ?' : 'slug = ?';
    const params = [byId ? Number(key) : String(key)];
    if (status) params.push(status);

    const [row] = await db.query(
      `SELECT ${SELECT} FROM blogs WHERE ${where}${status ? ' AND status = ?' : ''} LIMIT 1`,
      params
    );
    if (!row) return null;

    const content = await BlogModel.contentFor([row.id]);
    return toPublic(row, content[row.id] || []);
  },

  /** The raw row, for the checks a controller makes before writing. */
  async findRow(id) {
    const [row] = await db.query(`SELECT ${SELECT}, legacy_id FROM blogs WHERE id = ? LIMIT 1`, [id]);
    return row || null;
  },

  /** Creates the article with its body; returns the new id. */
  async create(data) {
    const cols = toColumns(data);
    cols.slug = await BlogModel.uniqueSlug(data.slug || data.title);
    if (!cols.publish_date) cols.publish_date = displayDate(new Date());
    if (cols.status === 'Published' && !cols.published_at) cols.published_at = new Date();

    return db.withTransaction(async (trx) => {
      const keys = Object.keys(cols);
      const { insertId } = await trx.query(
        `INSERT INTO blogs (${keys.join(', ')}) VALUES (${keys.map(() => '?').join(', ')})`,
        Object.values(cols)
      );
      await saveBlocks(trx, insertId, data.content);
      return insertId;
    });
  },

  /**
   * Updates the scalar fields, and replaces the body only when one was sent,
   * so a partial update does not wipe the article.
   */
  async update(id, data) {
    const cols = toColumns(data);
    if (data.slug !== undefined || data.title !== undefined) {
      if (data.slug !== undefined) cols.slug = await BlogModel.uniqueSlug(data.slug, id);
    }
    // Publishing for the first time stamps the date it went live.
    if (cols.status === 'Published' && data.publishedAt === undefined) {
      const current = await BlogModel.findRow(id);
      if (current && !current.published_at) cols.published_at = new Date();
    }

    return db.withTransaction(async (trx) => {
      const keys = Object.keys(cols);
      if (keys.length) {
        await trx.query(
          `UPDATE blogs SET ${keys.map(k => `${k} = ?`).join(', ')} WHERE id = ?`,
          [...keys.map(k => cols[k]), id]
        );
      }
      if (data.content !== undefined) await saveBlocks(trx, id, data.content);
      return true;
    });
  },

  /** Removes the article; its blocks and their items cascade. */
  async remove(id) {
    const result = await db.query('DELETE FROM blogs WHERE id = ?', [id]);
    return result.affectedRows > 0;
  },

  /** Removes several articles at once; returns how many went. */
  async removeMany(ids) {
    if (!ids.length) return 0;
    const result = await db.query('DELETE FROM blogs WHERE id IN (?)', [ids]);
    return result.affectedRows;
  },

  /** Counts a read of the article. Never fails the request it rides on. */
  async recordView(id) {
    try {
      await db.query('UPDATE blogs SET views = views + 1 WHERE id = ?', [id]);
    } catch (err) {
      // A view counter is not worth failing a page load for.
    }
  }
};

module.exports = BlogModel;
