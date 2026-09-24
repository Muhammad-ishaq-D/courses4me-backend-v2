const express = require('express');
const ReviewController = require('../controllers/reviewController');
const { protect } = require('../middlewares/authMiddleware');
const { validate } = require('../middlewares/validateMiddleware');
const validators = require('../validators');

const router = express.Router();

router.post('/', protect, validate(validators.review.create), ReviewController.create);
router.get('/my', protect, ReviewController.getMine);

module.exports = router;
