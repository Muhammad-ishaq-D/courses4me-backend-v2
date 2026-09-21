const User = require('../models/User');
const Notification = require('../models/Notification');
const Settings = require('../models/Settings');

// Creates an in-app notification for every admin/editor, honoring the
// Settings > Notifications toggles so admins can opt out of a category.
// If no settings document exists yet, or settingKey is omitted, the
// notification is sent (fails open rather than silently doing nothing).
const notifyAdmins = async ({ settingKey, title, message, type = 'system' }) => {
    try {
        if (settingKey) {
            const settings = await Settings.findOne();
            if (settings?.notifications?.[settingKey] === false) {
                return;
            }
        }

        const admins = await User.find({ role: { $in: ['admin', 'editor'] } });
        if (!admins.length) return;

        const notifications = admins.map((admin) => ({
            user: admin._id,
            title,
            message,
            type
        }));

        await Notification.insertMany(notifications);
    } catch (error) {
        console.error(`notifyAdmins error (${title}):`, error);
    }
};

module.exports = notifyAdmins;
