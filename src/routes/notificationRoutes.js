const express = require('express');
const {
    getNotifications,
    markAsRead,
    markAllAsRead
} = require('../controllers/notificationController');
const { protect } = require('../middlewares/authMiddleware');

const router = express.Router();

router.use(protect); // All routes are protected

router.get('/', getNotifications);
router.put('/readall', markAllAsRead);
router.put('/:id/read', markAsRead);

module.exports = router;
