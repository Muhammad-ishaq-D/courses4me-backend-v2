const express = require('express');
const CourseLocationController = require('../controllers/courseLocationController');
const { protect, authorize } = require('../middlewares/authMiddleware');
const { validate } = require('../middlewares/validateMiddleware');
const validators = require('../validators');

const router = express.Router();
const link = validators.courseLocation;
const adminOnly = [protect, authorize('admin')];

router.put('/:id', ...adminOnly, validate(link.idParam, 'params'), validate(link.updateDate), CourseLocationController.updateDate);
router.delete('/:id', ...adminOnly, validate(link.idParam, 'params'), CourseLocationController.deleteDate);

module.exports = router;
