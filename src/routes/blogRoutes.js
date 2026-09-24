const express = require('express');
const BlogController = require('../controllers/blogController');
const { protect, authorize, optionalProtect } = require('../middlewares/authMiddleware');
const { validate } = require('../middlewares/validateMiddleware');
const validators = require('../validators');

const router = express.Router();
const blog = validators.blog;
const adminOnly = [protect, authorize('admin', 'editor')];

// Public — the blog pages read these. `optionalProtect` so an admin previewing
// the site sees drafts while a visitor never does.
router.get('/', optionalProtect, validate(blog.list, 'query'), BlogController.getAll);

// Admin
router.post('/', ...adminOnly, validate(blog.create), BlogController.create);
router.delete('/', ...adminOnly, validate(blog.bulkDelete), BlogController.removeMany);

// Keyed routes last, so `/` above is not read as an id
router.get('/:id', optionalProtect, validate(blog.idParam, 'params'), BlogController.getById);
router.put('/:id', ...adminOnly, validate(blog.idParam, 'params'), validate(blog.update), BlogController.update);
router.delete('/:id', ...adminOnly, validate(blog.idParam, 'params'), BlogController.remove);

module.exports = router;
