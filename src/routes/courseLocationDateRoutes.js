const express = require('express');
const router = express.Router();
const { protect, authorize } = require('../middlewares/authMiddleware');
const { updateDate, deleteDate } = require('../controllers/courseLocationController');

router.put('/:id', protect, authorize('admin'), updateDate);
router.delete('/:id', protect, authorize('admin'), deleteDate);

module.exports = router;
