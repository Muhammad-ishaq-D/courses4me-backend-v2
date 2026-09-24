const BlogModel = require('../models/blogModel');
const cloudinary = require('../config/cloudinary');
const logger = require('../utils/logger');

const isAdmin = (req) => !!(req.user && (req.user.role === 'admin' || req.user.role === 'editor'));

/**
 * A cover sent as a base64 data URI is uploaded and stored as a URL; a URL is
 * kept as it is. The same handling the profile photo already gets, so an
 * article never carries a few hundred kilobytes of image in its row.
 */
async function resolveCover(value) {
  if (!value || typeof value !== 'string') return value;
  if (!value.startsWith('data:image')) return value;

  const upload = await cloudinary.uploader.upload(value, {
    folder: 'courses4me/blogs',
    transformation: [{ width: 1600, height: 900, crop: 'limit' }]
  });
  return upload.secure_url;
}

/** Moves whichever cover/author keys were sent into the model's shape. */
async function normalise(body) {
  const data = { ...body };

  const cover = data.image !== undefined ? data.image : data.coverImage;
  if (cover !== undefined) {
    data.coverImage = await resolveCover(cover);
    delete data.image;
  }

  // `author` is a name on the blog pages and an object in the editor.
  if (typeof data.author === 'string') {
    data.authorName = data.author;
    delete data.author;
  }
  if (data.role !== undefined) {
    data.authorRole = data.role;
    delete data.role;
  }
  return data;
}

const BlogController = {
  // @desc    Published articles for the blog, or everything for an admin
  // @route   GET /api/blogs
  // @access  Public
  async getAll(req, res, next) {
    try {
      const { category, search, featured, page, limit, withContent } = req.query;
      const admin = isAdmin(req);

      // A visitor only ever sees published articles, whatever they ask for.
      const status = admin
        ? (req.query.status && req.query.status !== 'All' ? req.query.status : undefined)
        : 'Published';

      const perPage = limit ? Number(limit) : undefined;
      const offset = perPage && page ? (Number(page) - 1) * perPage : undefined;

      const { rows, total } = await BlogModel.findAll({
        status,
        category,
        search,
        featured: featured === undefined || featured === '' ? undefined : !!featured,
        limit: perPage,
        offset,
        withContent: !!withContent
      });

      res.status(200).json({
        success: true,
        count: rows.length,
        total,
        categories: await BlogModel.categoryCounts(),
        data: rows,
        blogs: rows
      });
    } catch (error) {
      next(error);
    }
  },

  // @desc    One article, by id or slug
  // @route   GET /api/blogs/:id
  // @access  Public
  async getById(req, res, next) {
    try {
      const admin = isAdmin(req);
      const blog = await BlogModel.findOne(req.params.id, admin ? {} : { status: 'Published' });
      if (!blog) return res.status(404).json({ success: false, message: 'Blog not found' });

      if (!admin) await BlogModel.recordView(blog.id);

      res.status(200).json({ success: true, data: blog, blog });
    } catch (error) {
      next(error);
    }
  },

  // @desc    Create an article
  // @route   POST /api/blogs
  // @access  Private/Admin
  async create(req, res, next) {
    try {
      const data = await normalise(req.body);
      const id = await BlogModel.create(data);
      const blog = await BlogModel.findOne(id);

      logger.info(`[blogs] "${blog.title}" created`);
      res.status(201).json({ success: true, data: blog, blog });
    } catch (error) {
      next(error);
    }
  },

  // @desc    Update an article
  // @route   PUT /api/blogs/:id
  // @access  Private/Admin
  async update(req, res, next) {
    try {
      const row = await BlogModel.findRow(req.params.id);
      if (!row) return res.status(404).json({ success: false, message: 'Blog not found' });

      const data = await normalise(req.body);
      await BlogModel.update(row.id, data);
      const blog = await BlogModel.findOne(row.id);

      res.status(200).json({ success: true, data: blog, blog });
    } catch (error) {
      next(error);
    }
  },

  // @desc    Delete an article
  // @route   DELETE /api/blogs/:id
  // @access  Private/Admin
  async remove(req, res, next) {
    try {
      const removed = await BlogModel.remove(req.params.id);
      if (!removed) return res.status(404).json({ success: false, message: 'Blog not found' });

      res.status(200).json({ success: true, message: 'Blog deleted', data: {} });
    } catch (error) {
      next(error);
    }
  },

  // @desc    Delete several articles at once
  // @route   DELETE /api/blogs
  // @access  Private/Admin
  async removeMany(req, res, next) {
    try {
      const deleted = await BlogModel.removeMany(req.body.ids);
      res.status(200).json({ success: true, message: `${deleted} blog(s) deleted`, deleted, data: {} });
    } catch (error) {
      next(error);
    }
  }
};

module.exports = BlogController;
