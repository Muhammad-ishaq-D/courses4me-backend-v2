const { Joi, id, optionalString, optionalBool, optionalDate } = require('./common');

const CATEGORIES = ['Career Guide', 'Industry News', 'Study Tips', 'Company News', 'Training', 'Technology'];
const STATUSES = ['Published', 'Draft', 'Archived'];
const BLOCK_TYPES = ['paragraph', 'heading', 'subheading', 'list', 'numberedList', 'quote', 'image'];
const LIST_TYPES = ['list', 'numberedList'];

/**
 * One block of the body. A list block carries `items`, everything else
 * carries `text`; the wrong one for the type is rejected rather than dropped,
 * so a mistake in the editor is visible instead of silently losing content.
 */
const block = Joi.object({
  type: Joi.string().valid(...BLOCK_TYPES).required(),
  text: Joi.when('type', {
    is: Joi.valid(...LIST_TYPES),
    then: Joi.forbidden(),
    otherwise: Joi.string().allow('').max(20000).required()
  }),
  items: Joi.when('type', {
    is: Joi.valid(...LIST_TYPES),
    then: Joi.array().items(Joi.string().trim().max(1000).allow('')).max(200).required(),
    otherwise: Joi.forbidden()
  })
});

const content = Joi.array().items(block).max(300);

// The cover may be a hosted URL or a base64 data URI the admin pasted in.
const image = Joi.alternatives()
  .try(Joi.string().uri({ allowRelative: true }).max(500), Joi.string().pattern(/^data:image\//).max(10 * 1024 * 1024))
  .allow(null, '');

const base = {
  title: Joi.string().trim().min(3).max(255),
  slug: Joi.string().trim().lowercase().max(200).pattern(/^[a-z0-9-]+$/).allow(null, ''),
  excerpt: Joi.string().trim().max(2000).allow(''),
  category: Joi.string().valid(...CATEGORIES),
  image,
  coverImage: image,
  author: Joi.alternatives().try(
    Joi.string().trim().max(150).allow(''),
    Joi.object({
      name: optionalString(150),
      role: optionalString(150),
      avatar: Joi.string().uri({ allowRelative: true }).max(500).allow(null, '')
    })
  ),
  authorName: optionalString(150),
  role: optionalString(150),
  authorRole: optionalString(150),
  authorAvatar: Joi.string().uri({ allowRelative: true }).max(500).allow(null, ''),
  publishDate: optionalString(60),
  readTime: optionalString(40),
  featured: optionalBool,
  status: Joi.string().valid(...STATUSES),
  publishedAt: optionalDate,
  content
};

module.exports = {
  CATEGORIES,
  STATUSES,
  BLOCK_TYPES,

  idParam: Joi.object({ id: Joi.alternatives().try(id, Joi.string().trim().max(200)).required() }),

  list: Joi.object({
    category: Joi.string().valid(...CATEGORIES, 'All').allow(''),
    status: Joi.string().valid(...STATUSES, 'All').allow(''),
    search: optionalString(200),
    featured: optionalBool,
    page: Joi.number().integer().min(1),
    limit: Joi.number().integer().min(1).max(100),
    withContent: optionalBool
  }),

  create: Joi.object({
    ...base,
    title: base.title.required(),
    content: content.default([])
  }),

  update: Joi.object(base).min(1),

  bulkDelete: Joi.object({
    ids: Joi.array().items(id).min(1).max(200).required()
  })
};
