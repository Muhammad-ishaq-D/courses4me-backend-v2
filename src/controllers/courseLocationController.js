const CourseLocationModel = require('../models/courseLocationModel');
const LocationModel = require('../models/locationModel');

/**
 * Seat counts are reported as availability: `availableSeats` is what is left
 * and `bookedSeats` is hidden from the client.
 */
const asAvailability = (date) => ({
  ...date,
  availableSeats: Math.max(0, (date.availableSeats || 0) - (date.bookedSeats || 0)),
  bookedSeats: 0
});

/** Seats left plus the label the listings show. */
function withSeatSummary(date) {
  const remaining = Math.max(0, (date.availableSeats || 0) - (date.bookedSeats || 0));
  return {
    ...date,
    seatsRemaining: remaining,
    availabilityStatus: remaining <= 0 ? 'Sold Out' : (remaining <= 5 ? 'Selling Fast' : 'Available')
  };
}

/** Links with their location, course and dates attached. */
async function expandLinks(links) {
  if (!links.length) return [];
  const [locations, courses, dates] = await Promise.all([
    CourseLocationModel.locationsByIds(links.map(l => l.location_id)),
    CourseLocationModel.coursesByIds(links.map(l => l.course_id)),
    CourseLocationModel.datesFor(links.map(l => l.id))
  ]);

  return links.map(link => CourseLocationModel.linkToPublic(link, {
    location: locations[link.location_id] || null,
    course: CourseLocationModel.courseSummary(courses[link.course_id]),
    dates: (dates[link.id] || []).map(asAvailability)
  }));
}

const CourseLocationController = {
  // @desc    Active links of published courses
  // @route   GET /api/course-locations
  // @access  Public
  async getAll(req, res, next) {
    try {
      // Inactive locations are included so the portal can show them greyed out;
      // the client decides using locationId.status.
      const links = await CourseLocationModel.findActiveForPublishedCourses();
      res.json({ success: true, data: await expandLinks(links) });
    } catch (error) {
      next(error);
    }
  },

  // @desc    Links of one course
  // @route   GET /api/course-locations/course/:courseId?activeOnly=true
  // @access  Public
  async getByCourse(req, res, next) {
    try {
      // activeOnly hides inactive links and disabled locations. Both apps omit
      // it today; it is kept for any caller that wants a bookable-only list.
      const links = await CourseLocationModel.findByCourse(req.params.courseId, {
        activeOnly: req.query.activeOnly === 'true'
      });
      res.json({ success: true, data: await expandLinks(links) });
    } catch (error) {
      next(error);
    }
  },

  // @desc    Get one link
  // @route   GET /api/course-locations/:id
  // @access  Public
  async getById(req, res, next) {
    try {
      const link = await CourseLocationModel.findById(req.params.id);
      if (!link) return res.status(404).json({ success: false, message: 'Course location not found' });
      const [data] = await expandLinks([link]);
      res.json({ success: true, data });
    } catch (error) {
      next(error);
    }
  },

  // @desc    Link a location to a course
  // @route   POST /api/course-locations/course/:courseId
  // @access  Private/Admin
  async create(req, res, next) {
    try {
      const { locationId } = req.body;

      const location = await LocationModel.findById(locationId);
      if (!location) return res.status(404).json({ success: false, message: 'Location not found' });
      if (location.status === 'Inactive') {
        return res.status(400).json({ success: false, message: 'Cannot link an inactive location to a course' });
      }

      if (await CourseLocationModel.findByPair(req.params.courseId, locationId)) {
        return res.status(400).json({
          success: false,
          message: 'This location is already linked to this course. The same location cannot be added twice.'
        });
      }

      const id = await CourseLocationModel.create(req.params.courseId, locationId, req.body);
      const [data] = await expandLinks([await CourseLocationModel.findById(id)]);
      res.status(201).json({ success: true, data });
    } catch (error) {
      if (error.code === 'ER_DUP_ENTRY') {
        return res.status(400).json({ success: false, message: 'This location is already linked to this course' });
      }
      if (error.code === 'ER_NO_REFERENCED_ROW_2') {
        return res.status(404).json({ success: false, message: 'Course not found' });
      }
      next(error);
    }
  },

  // @desc    Update a link and, when supplied, its full set of dates
  // @route   PUT /api/course-locations/:id
  // @access  Private/Admin
  async update(req, res, next) {
    try {
      const existing = await CourseLocationModel.findById(req.params.id);
      if (!existing) return res.status(404).json({ success: false, message: 'Course location not found' });

      await CourseLocationModel.update(existing.id, req.body);
      const [data] = await expandLinks([await CourseLocationModel.findById(existing.id)]);
      res.json({ success: true, data });
    } catch (error) {
      next(error);
    }
  },

  // @desc    Remove a location from a course
  // @route   DELETE /api/course-locations/:id
  // @access  Private/Admin
  async delete(req, res, next) {
    try {
      await CourseLocationModel.delete(req.params.id);
      res.json({ success: true, message: 'Location removed from course' });
    } catch (error) {
      next(error);
    }
  },

  // @desc    Add a date to a link
  // @route   POST /api/course-locations/:id/dates
  // @access  Private/Admin
  async addDate(req, res, next) {
    try {
      const link = await CourseLocationModel.findById(req.params.id);
      if (!link) return res.status(404).json({ success: false, message: 'Course location not found' });

      const id = await CourseLocationModel.addDate(link.id, req.body);
      const date = await CourseLocationModel.findDateById(id);
      res.status(201).json({ success: true, data: asAvailability(withSeatSummary(date)) });
    } catch (error) {
      next(error);
    }
  },

  // @desc    Update a date
  // @route   PUT /api/course-location-dates/:id
  // @access  Private/Admin
  async updateDate(req, res, next) {
    try {
      const existing = await CourseLocationModel.findDateById(req.params.id);
      if (!existing) return res.status(404).json({ success: false, message: 'Date not found' });

      await CourseLocationModel.updateDate(existing.id, req.body);
      const date = await CourseLocationModel.findDateById(existing.id);
      res.json({ success: true, data: asAvailability(withSeatSummary(date)) });
    } catch (error) {
      next(error);
    }
  },

  // @desc    Delete a date
  // @route   DELETE /api/course-location-dates/:id
  // @access  Private/Admin
  async deleteDate(req, res, next) {
    try {
      await CourseLocationModel.deleteDate(req.params.id);
      res.json({ success: true, message: 'Date removed' });
    } catch (error) {
      next(error);
    }
  }
};

module.exports = CourseLocationController;
