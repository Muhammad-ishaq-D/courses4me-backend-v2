const LocationModel = require('../models/locationModel');
const CourseLocationModel = require('../models/courseLocationModel');

/** Attaches facilities and gallery to a row already read from `locations`. */
async function withChildren(row, extras = {}) {
  const [facilities, gallery] = await Promise.all([
    LocationModel.facilitiesFor([row.id]),
    LocationModel.galleryFor([row.id])
  ]);
  return LocationModel.toPublic(row, { facilities: facilities[row.id] || [], gallery: gallery[row.id] || [], ...extras });
}

const LocationController = {
  // @desc    List locations
  // @route   GET /api/locations?search=&status=&page=&limit=
  // @access  Public
  async getAll(req, res, next) {
    try {
      const page = Number(req.query.page) || 1;
      const limit = Number(req.query.limit) || 20;
      const { rows, total } = await LocationModel.findAll(req.query, { limit, offset: (page - 1) * limit });

      const ids = rows.map(r => r.id);
      const [facilities, gallery, counts] = await Promise.all([
        LocationModel.facilitiesFor(ids),
        LocationModel.galleryFor(ids),
        LocationModel.publishedCourseCounts(ids)
      ]);

      const data = rows.map(row => LocationModel.toPublic(row, {
        facilities: facilities[row.id] || [],
        gallery: gallery[row.id] || [],
        linkedCoursesCount: counts[row.id] || 0
      }));

      res.json({
        success: true,
        data,
        pagination: { total, page, limit, pages: Math.ceil(total / limit) }
      });
    } catch (error) {
      next(error);
    }
  },

  // @desc    Get one location
  // @route   GET /api/locations/:id
  // @access  Public
  async getById(req, res, next) {
    try {
      const row = await LocationModel.findById(req.params.id);
      if (!row) return res.status(404).json({ success: false, message: 'Location not found' });
      const linkedCoursesCount = await LocationModel.linkCount(row.id);
      res.json({ success: true, data: await withChildren(row, { linkedCoursesCount }) });
    } catch (error) {
      next(error);
    }
  },

  // @desc    Create a location
  // @route   POST /api/locations
  // @access  Private/Admin
  async create(req, res, next) {
    try {
      const id = await LocationModel.create(req.body);
      const row = await LocationModel.findById(id);
      res.status(201).json({ success: true, data: await withChildren(row) });
    } catch (error) {
      next(error);
    }
  },

  // @desc    Update a location
  // @route   PUT /api/locations/:id
  // @access  Private/Admin
  async update(req, res, next) {
    try {
      const existing = await LocationModel.findById(req.params.id);
      if (!existing) return res.status(404).json({ success: false, message: 'Location not found' });

      await LocationModel.update(existing.id, req.body);
      const row = await LocationModel.findById(existing.id);
      res.json({ success: true, data: await withChildren(row) });
    } catch (error) {
      next(error);
    }
  },

  // @desc    Set or flip the status of a location
  // @route   PATCH /api/locations/:id/status
  // @access  Private/Admin
  async toggleStatus(req, res, next) {
    try {
      const existing = await LocationModel.findById(req.params.id);
      if (!existing) return res.status(404).json({ success: false, message: 'Location not found' });

      const status = req.body.status || (existing.status === 'Active' ? 'Inactive' : 'Active');
      await LocationModel.setStatus(existing.id, status);
      const row = await LocationModel.findById(existing.id);
      res.json({ success: true, data: await withChildren(row) });
    } catch (error) {
      next(error);
    }
  },

  // @desc    Courses linked to a location
  // @route   GET /api/locations/:id/courses
  // @access  Public
  async getLinkedCourses(req, res, next) {
    try {
      const links = await CourseLocationModel.findByLocation(req.params.id);
      const courses = await CourseLocationModel.coursesByIds(links.map(l => l.course_id));

      const data = links.map(link => {
        const { dates, locationId, ...rest } = CourseLocationModel.linkToPublic(link, {
          course: CourseLocationModel.courseBrief(courses[link.course_id])
        });
        return { ...rest, locationId: String(link.location_id) };
      });

      res.json({ success: true, data });
    } catch (error) {
      next(error);
    }
  }
};

module.exports = LocationController;
