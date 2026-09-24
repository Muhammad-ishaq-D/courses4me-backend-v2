const NotificationModel = require('../models/notificationModel');

const NotificationController = {
  // @desc    The signed-in user's most recent notifications
  // @route   GET /api/notifications
  // @access  Private
  async getAll(req, res, next) {
    try {
      const [rows, unreadCount] = await Promise.all([
        NotificationModel.findForUser(req.user.id),
        NotificationModel.countUnread(req.user.id)
      ]);
      const data = rows.map(NotificationModel.toPublic);
      res.status(200).json({ success: true, count: data.length, unreadCount, data });
    } catch (error) {
      next(error);
    }
  },

  // @desc    Mark one notification as read
  // @route   PUT /api/notifications/:id/read
  // @access  Private
  async markAsRead(req, res, next) {
    try {
      const row = await NotificationModel.findById(req.params.id);
      if (!row) return res.status(404).json({ success: false, message: 'Notification not found' });
      if (String(row.user_id) !== String(req.user.id)) {
        return res.status(401).json({ success: false, message: 'Not authorized' });
      }

      await NotificationModel.markRead(row.id);
      const updated = await NotificationModel.findById(row.id);
      res.status(200).json({ success: true, data: NotificationModel.toPublic(updated) });
    } catch (error) {
      next(error);
    }
  },

  // @desc    Mark every notification as read
  // @route   PUT /api/notifications/readall
  // @access  Private
  async markAllAsRead(req, res, next) {
    try {
      await NotificationModel.markAllRead(req.user.id);
      res.status(200).json({ success: true, message: 'All notifications marked as read' });
    } catch (error) {
      next(error);
    }
  }
};

module.exports = NotificationController;
