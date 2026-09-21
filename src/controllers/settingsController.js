const Settings = require('../models/Settings');

const getOrCreateSettings = async () => {
    let settings = await Settings.findOne();
    if (!settings) {
        settings = await Settings.create({});
    }
    return settings;
};

// @desc    Get platform settings (creates default doc if none exists)
// @route   GET /api/settings
// @access  Private/Admin
exports.getSettings = async (req, res) => {
    try {
        const settings = await getOrCreateSettings();
        res.status(200).json({ success: true, data: settings });
    } catch (error) {
        res.status(500).json({ success: false, message: error.message });
    }
};

// @desc    Update platform settings
// @route   PUT /api/settings
// @access  Private/Admin
exports.updateSettings = async (req, res) => {
    try {
        const { general, notifications, emailTemplates } = req.body;
        const settings = await getOrCreateSettings();

        if (general !== undefined) {
            settings.general = general;
            settings.markModified('general');
        }
        if (notifications !== undefined) {
            settings.notifications = notifications;
            settings.markModified('notifications');
        }
        if (emailTemplates !== undefined) {
            settings.emailTemplates = emailTemplates;
            settings.markModified('emailTemplates');
        }

        await settings.save();

        res.status(200).json({ success: true, data: settings });
    } catch (error) {
        res.status(500).json({ success: false, message: error.message });
    }
};
