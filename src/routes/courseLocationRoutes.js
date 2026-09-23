const express = require('express');
const CourseLocationController = require('../controllers/courseLocationController');
const { protect, authorize } = require('../middlewares/authMiddleware');
const { validate } = require('../middlewares/validateMiddleware');
const validators = require('../validators');

const router = express.Router();
const link = validators.courseLocation;
const adminOnly = [protect, authorize('admin')];

// All active links of published courses (public scheduling feed)
router.get('/', CourseLocationController.getAll);

// Links of one course
router.get('/course/:courseId', validate(link.courseIdParam, 'params'), validate(link.list, 'query'), CourseLocationController.getByCourse);
router.post('/course/:courseId', ...adminOnly, validate(link.courseIdParam, 'params'), validate(link.create), CourseLocationController.create);

// One link
router.get('/:id', validate(link.idParam, 'params'), CourseLocationController.getById);
router.put('/:id', ...adminOnly, validate(link.idParam, 'params'), validate(link.update), CourseLocationController.update);
router.delete('/:id', ...adminOnly, validate(link.idParam, 'params'), CourseLocationController.delete);

// Dates nested under a link
router.post('/:id/dates', ...adminOnly, validate(link.idParam, 'params'), validate(link.createDate), CourseLocationController.addDate);

module.exports = router;
