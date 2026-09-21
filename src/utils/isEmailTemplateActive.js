const Settings = require('../models/Settings');

// Checks whether a Settings > Email Templates entry is active.
// Fails open (true) if no settings doc exists yet or the key isn't recognized,
// so email delivery isn't silently broken by a missing settings document.
const isEmailTemplateActive = async (key) => {
    try {
        const settings = await Settings.findOne();
        const template = settings?.emailTemplates?.find((t) => t.key === key);
        return template ? template.isActive !== false : true;
    } catch (error) {
        console.error(`isEmailTemplateActive error (${key}):`, error);
        return true;
    }
};

module.exports = isEmailTemplateActive;
