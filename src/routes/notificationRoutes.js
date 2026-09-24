const express = require('express');
const NotificationController = require('../controllers/notificationController');
const { protect } = require('../middlewares/authMiddleware');
const { validate } = require('../middlewares/validateMiddleware');
const validators = require('../validators');

const router = express.Router();

router.use(protect);

router.get('/', NotificationController.getAll);
// Declared before /:id/read so the literal path is not read as an id
router.put('/readall', NotificationController.markAllAsRead);
router.put('/:id/read', validate(validators.dashboard.idParam, 'params'), NotificationController.markAsRead);

module.exports = router;
