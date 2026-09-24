const SettingsModel = require('../models/settingsModel');

const SettingsController = {
  // @desc    Platform settings (created with the defaults on first read)
  // @route   GET /api/settings
  // @access  Private/Admin
  async get(req, res, next) {
    try {
      const row = await SettingsModel.findOrCreate();
      res.status(200).json({ success: true, data: SettingsModel.toPublic(row) });
    } catch (error) {
      next(error);
    }
  },

  // @desc    Update platform settings
  // @route   PUT /api/settings
  // @access  Private/Admin
  async update(req, res, next) {
    try {
      const row = await SettingsModel.findOrCreate();
      await SettingsModel.update(row.id, req.body);

      const updated = await SettingsModel.find();
      res.status(200).json({ success: true, data: SettingsModel.toPublic(updated) });
    } catch (error) {
      next(error);
    }
  }
};

module.exports = SettingsController;
