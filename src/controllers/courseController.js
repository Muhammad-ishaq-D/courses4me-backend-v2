const CourseModel = require('../models/courseModel');
const { enrichLocationsWithCoordinates } = require('../utils/geocodePostcode');
const { scheduledSessionsFor } = require('../services/courseSessionService');
const { resolveLicense } = require('../services/licenseLookupService');

function applyUploads(data, files) {
  if (!files) return;
  if (files.thumbnail) {
    data.thumbnail = files.thumbnail[0].path;
  }
  if (files.instructorPhoto) {
    if (!data.instructor) data.instructor = {};
    data.instructor.photo = files.instructorPhoto[0].path;
  }
}

const isAdmin = (req) => !!(req.user && req.user.role === 'admin');

/** One course with its lists, venues and the sessions of those venues. */
async function loadCourse(row) {
  const [listItems, venues] = await Promise.all([
    CourseModel.listItemsFor([row.id]),
    CourseModel.venuesFor([row.id])
  ]);
  const courseVenues = venues[row.id] || [];
  return CourseModel.toPublic(row, {
    listItems: listItems[row.id] || [],
    venues: courseVenues,
    sessions: CourseModel.venueSessions(courseVenues)
  });
}

const CourseController = {
  // @desc    Create new course
  // @route   POST /api/courses
  // @access  Private/Admin
  async create(req, res, next) {
    try {
      const courseData = req.body;
      applyUploads(courseData, req.files);

      if (courseData.locations?.length) {
        courseData.locations = await enrichLocationsWithCoordinates(courseData.locations);
      }

      const id = await CourseModel.create(courseData);
      const row = await CourseModel.findById(id);
      res.status(201).json({ success: true, data: await loadCourse(row) });
    } catch (error) {
      next(error);
    }
  },

  // @desc    Get all courses
  // @route   GET /api/courses
  // @access  Public
  async getAll(req, res, next) {
    try {
      const { category, status, search, location } = req.query;
      // Anyone who is not an admin only ever sees published courses.
      const effectiveStatus = status || (isAdmin(req) ? undefined : 'Published');

      const rows = await CourseModel.findAll({ category, status: effectiveStatus, search, location });
      const ids = rows.map(r => r.id);

      const [listItems, venues, scheduled] = await Promise.all([
        CourseModel.listItemsFor(ids),
        CourseModel.venuesFor(ids),
        scheduledSessionsFor(ids)
      ]);

      const data = rows.map(row => {
        const courseVenues = venues[row.id] || [];
        return CourseModel.toPublic(row, {
          listItems: listItems[row.id] || [],
          venues: courseVenues,
          sessions: [...CourseModel.venueSessions(courseVenues), ...(scheduled[row.id] || [])]
        });
      });

      res.status(200).json({ success: true, count: data.length, data });
    } catch (error) {
      next(error);
    }
  },

  // @desc    Get single course
  // @route   GET /api/courses/:id
  // @access  Public
  async getById(req, res, next) {
    try {
      let row = await CourseModel.findById(req.params.id);
      let license = null;

      // The id may belong to a licence, which resolves to the course that
      // teaches it, or to the licence itself when nothing matches.
      if (!row) {
        const resolved = await resolveLicense(req.params.id);
        if (resolved?.courseId) row = await CourseModel.findById(resolved.courseId);
        if (!row && resolved?.license) license = resolved.license;
      }

      if (!row && !license) {
        return res.status(404).json({ success: false, message: 'Course or License not found' });
      }

      const status = row ? row.status : license.status;
      if (!isAdmin(req) && status && status !== 'Published' && status !== 'Active') {
        return res.status(403).json({ success: false, message: 'This course/license is currently not available' });
      }

      res.status(200).json({ success: true, data: row ? await loadCourse(row) : license });
    } catch (error) {
      next(error);
    }
  },

  // @desc    Update course
  // @route   PUT /api/courses/:id
  // @access  Private/Admin
  async update(req, res, next) {
    try {
      const updateData = req.body;
      applyUploads(updateData, req.files);

      const existing = await CourseModel.findById(req.params.id);
      if (!existing) {
        return res.status(404).json({ success: false, message: 'Course not found' });
      }

      if (updateData.locations?.length) {
        updateData.locations = await enrichLocationsWithCoordinates(updateData.locations);
      }

      await CourseModel.update(existing.id, updateData);
      const row = await CourseModel.findById(existing.id);
      res.status(200).json({ success: true, data: await loadCourse(row) });
    } catch (error) {
      next(error);
    }
  },

  // @desc    Get course count by category
  // @route   GET /api/courses/stats/categories
  // @access  Public
  async getCategoryStats(req, res, next) {
    try {
      const data = await CourseModel.countByCategory(isAdmin(req) ? {} : { status: 'Published' });
      res.status(200).json({ success: true, data });
    } catch (error) {
      next(error);
    }
  },

  // @desc    Delete course
  // @route   DELETE /api/courses/:id
  // @access  Private/Admin
  async delete(req, res, next) {
    try {
      const deleted = await CourseModel.delete(req.params.id);
      if (!deleted) {
        return res.status(404).json({ success: false, message: 'Course not found' });
      }
      res.status(200).json({ success: true, data: {} });
    } catch (error) {
      next(error);
    }
  }
};

module.exports = CourseController;
