const LicenseModel = require('../models/licenseModel');

const isAdmin = (req) => !!(req.user && req.user.role === 'admin');

/** One licence with its lists, steps, fees, related courses and venues. */
async function loadLicense(row, { fullRelatedCourses = false } = {}) {
  const ids = [row.id];
  const [listItems, applicationSteps, pricingBreakdown, relatedCourses, venues] = await Promise.all([
    LicenseModel.listItemsFor(ids),
    LicenseModel.applicationStepsFor(ids),
    LicenseModel.pricingBreakdownFor(ids),
    LicenseModel.relatedCoursesFor(ids, { full: fullRelatedCourses }),
    LicenseModel.venuesFor(ids)
  ]);

  return LicenseModel.toPublic(row, {
    listItems: listItems[row.id] || [],
    applicationSteps: applicationSteps[row.id] || [],
    pricingBreakdown: pricingBreakdown[row.id] || [],
    relatedCourses: relatedCourses[row.id] || [],
    venues: venues[row.id] || []
  });
}

const LicenseController = {
  // @desc    Create a licence
  // @route   POST /api/licenses
  // @access  Private/Admin
  async create(req, res, next) {
    try {
      const data = req.body;
      // The credential is issued in the licence holder's name unless one is given.
      if (!data.holderName && data.title) data.holderName = data.title;

      const id = await LicenseModel.create(data);
      const row = await LicenseModel.findById(id);
      res.status(201).json({ success: true, data: await loadLicense(row) });
    } catch (error) {
      next(error);
    }
  },

  // @desc    List licences
  // @route   GET /api/licenses?category=&status=&search=&page=&limit=
  // @access  Public
  async getAll(req, res, next) {
    try {
      const page = Number(req.query.page) || 1;
      const limit = Number(req.query.limit) || 10;
      const { category, status, search } = req.query;
      // Anyone who is not an admin only ever sees published licences.
      const effectiveStatus = status || (isAdmin(req) ? undefined : 'Published');

      const { rows, total } = await LicenseModel.findAll(
        { category, status: effectiveStatus, search },
        { limit, offset: (page - 1) * limit }
      );

      const ids = rows.map(r => r.id);
      const [listItems, applicationSteps, pricingBreakdown, relatedCourses, venues] = await Promise.all([
        LicenseModel.listItemsFor(ids),
        LicenseModel.applicationStepsFor(ids),
        LicenseModel.pricingBreakdownFor(ids),
        LicenseModel.relatedCoursesFor(ids),
        LicenseModel.venuesFor(ids)
      ]);

      const data = rows.map(row => LicenseModel.toPublic(row, {
        listItems: listItems[row.id] || [],
        applicationSteps: applicationSteps[row.id] || [],
        pricingBreakdown: pricingBreakdown[row.id] || [],
        relatedCourses: relatedCourses[row.id] || [],
        venues: venues[row.id] || []
      }));

      res.status(200).json({
        success: true,
        licenses: data,
        total,
        page,
        limit,
        // The same list under the keys the other endpoints use
        count: data.length,
        data
      });
    } catch (error) {
      next(error);
    }
  },

  // @desc    Get one licence
  // @route   GET /api/licenses/:id
  // @access  Public
  async getById(req, res, next) {
    try {
      const row = await LicenseModel.findById(req.params.id);
      if (!row) return res.status(404).json({ success: false, message: 'License not found' });

      if (!isAdmin(req) && row.status !== 'Published') {
        return res.status(403).json({ success: false, message: 'This license is currently not available' });
      }

      const license = await loadLicense(row, { fullRelatedCourses: true });
      // Also spread at the top level, for callers that read the licence directly
      res.status(200).json({ success: true, data: license, ...license });
    } catch (error) {
      next(error);
    }
  },

  // @desc    Update a licence
  // @route   PUT /api/licenses/:id
  // @access  Private/Admin
  async update(req, res, next) {
    try {
      const existing = await LicenseModel.findById(req.params.id);
      if (!existing) return res.status(404).json({ success: false, message: 'License not found' });

      await LicenseModel.update(existing.id, req.body);
      const row = await LicenseModel.findById(existing.id);
      res.status(200).json({ success: true, data: await loadLicense(row) });
    } catch (error) {
      next(error);
    }
  },

  // @desc    Delete a licence
  // @route   DELETE /api/licenses/:id
  // @access  Private/Admin
  async delete(req, res, next) {
    try {
      const deleted = await LicenseModel.delete(req.params.id);
      if (!deleted) return res.status(404).json({ success: false, message: 'License not found' });
      res.status(200).json({ success: true, message: 'License deleted successfully', data: {} });
    } catch (error) {
      next(error);
    }
  }
};

module.exports = LicenseController;
