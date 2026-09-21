const CourseLocation = require('../models/CourseLocation');
const CourseLocationDate = require('../models/CourseLocationDate');
const Location = require('../models/Location');

const populateLink = (query) =>
    query
        .populate('locationId')
        .populate('courseId', 'title category duration thumbnail pricing guarantee shortDescription status');

const mapDatesForClient = (dates) => {
    return (dates || []).map(d => {
        const remaining = Math.max(0, (d.availableSeats || 0) - (d.bookedSeats || 0));
        return {
            ...d,
            availableSeats: remaining,
            bookedSeats: 0
        };
    });
};

// GET /api/course-locations  (all active links for published courses — used by public location search)
const getAllCourseLocations = async (req, res) => {
    try {
        const links = await populateLink(CourseLocation.find({ status: 'Active' })).lean();
        // Surface links for published courses. Disabled (Inactive) locations are included
        // so the portal can still show them greyed out / non-selectable — the client uses
        // locationId.status to disable booking on them.
        const publishedLinks = links.filter((l) =>
            l.courseId && l.courseId.status === 'Published' &&
            l.locationId);
        const linksWithDates = await Promise.all(publishedLinks.map(async (link) => {
            const dates = await CourseLocationDate.find({ courseLocationId: link._id })
                .sort({ startDate: 1 }).lean();
            return { ...link, dates: mapDatesForClient(dates) };
        }));
        res.json({ success: true, data: linksWithDates });
    } catch (error) {
        res.status(500).json({ success: false, message: error.message });
    }
};

// GET /api/course-locations/course/:courseId
const getCourseLocations = async (req, res) => {
    try {
        // Optional ?activeOnly=true hides disabled locations / inactive links.
        // Both the portal and admin now omit it: the portal shows disabled locations
        // greyed out / non-selectable, and admin keeps full visibility. Kept for any
        // caller that still wants an active-only list.
        const activeOnly = req.query.activeOnly === 'true';

        const filter = { courseId: req.params.courseId };
        if (activeOnly) filter.status = 'Active';

        let links = await populateLink(CourseLocation.find(filter)).lean();

        if (activeOnly) {
            links = links.filter((l) => l.locationId && l.locationId.status === 'Active');
        }

        const linksWithDates = await Promise.all(links.map(async (link) => {
            const dates = await CourseLocationDate.find({ courseLocationId: link._id })
                .sort({ startDate: 1 }).lean();
            return { ...link, dates: mapDatesForClient(dates) };
        }));

        res.json({ success: true, data: linksWithDates });
    } catch (error) {
        res.status(500).json({ success: false, message: error.message });
    }
};

// GET /api/course-locations/:id
const getCourseLocation = async (req, res) => {
    try {
        const link = await populateLink(CourseLocation.findById(req.params.id)).lean();
        if (!link) return res.status(404).json({ success: false, message: 'Course location not found' });

        const dates = await CourseLocationDate.find({ courseLocationId: req.params.id })
            .sort({ startDate: 1 }).lean();

        res.json({ success: true, data: { ...link, dates: mapDatesForClient(dates) } });
    } catch (error) {
        res.status(500).json({ success: false, message: error.message });
    }
};

// POST /api/course-locations/course/:courseId
const createCourseLocation = async (req, res) => {
    try {
        const { locationId, price, vatIncluded, depositRequired, depositAmount, whatsIncluded, dates } = req.body;

        const location = await Location.findById(locationId);
        if (!location) return res.status(404).json({ success: false, message: 'Location not found' });
        if (location.status === 'Inactive') {
            return res.status(400).json({ success: false, message: 'Cannot link an inactive location to a course' });
        }

        // Check for duplicate: same location already linked to this course
        const existingLink = await CourseLocation.findOne({ courseId: req.params.courseId, locationId });
        if (existingLink) {
            return res.status(400).json({ success: false, message: 'This location is already linked to this course. The same location cannot be added twice.' });
        }

        const link = await CourseLocation.create({
            courseId: req.params.courseId,
            locationId,
            price,
            vatIncluded,
            depositRequired,
            depositAmount,
            whatsIncluded
        });

        if (dates && dates.length > 0) {
            await CourseLocationDate.insertMany(
                dates.map(d => ({ courseLocationId: link._id, ...d }))
            );
        }

        const fullLink = await populateLink(CourseLocation.findById(link._id)).lean();
        const createdDates = await CourseLocationDate.find({ courseLocationId: link._id })
            .sort({ startDate: 1 }).lean();

        res.status(201).json({ success: true, data: { ...fullLink, dates: mapDatesForClient(createdDates) } });
    } catch (error) {
        if (error.code === 11000) {
            return res.status(400).json({ success: false, message: 'This location is already linked to this course' });
        }
        res.status(400).json({ success: false, message: error.message });
    }
};

// PUT /api/course-locations/:id
const updateCourseLocation = async (req, res) => {
    try {
        const { price, vatIncluded, depositRequired, depositAmount, whatsIncluded, status, dates } = req.body;
        const link = await CourseLocation.findByIdAndUpdate(
            req.params.id,
            { price, vatIncluded, depositRequired, depositAmount, whatsIncluded, status },
            { new: true, runValidators: true }
        ).populate('locationId');
        if (!link) return res.status(404).json({ success: false, message: 'Course location not found' });

        if (dates && Array.isArray(dates)) {
            const incomingIds = dates.map(d => d._id).filter(id => id);
            
            // Delete dates that are not in the incoming list
            await CourseLocationDate.deleteMany({
                courseLocationId: link._id,
                _id: { $nin: incomingIds }
            });

            // Update existing or create new
            for (const d of dates) {
                if (d._id) {
                    await CourseLocationDate.findByIdAndUpdate(d._id, d, { runValidators: true });
                } else {
                    await CourseLocationDate.create({ courseLocationId: link._id, ...d });
                }
            }
        }

        const updatedDates = await CourseLocationDate.find({ courseLocationId: link._id })
            .sort({ startDate: 1 }).lean();

        res.json({ success: true, data: { ...link.toObject ? link.toObject() : link, dates: mapDatesForClient(updatedDates) } });
    } catch (error) {
        res.status(400).json({ success: false, message: error.message });
    }
};

// DELETE /api/course-locations/:id
const deleteCourseLocation = async (req, res) => {
    try {
        await CourseLocationDate.deleteMany({ courseLocationId: req.params.id });
        await CourseLocation.findByIdAndDelete(req.params.id);
        res.json({ success: true, message: 'Location removed from course' });
    } catch (error) {
        res.status(500).json({ success: false, message: error.message });
    }
};

// POST /api/course-locations/:id/dates
const addDate = async (req, res) => {
    try {
        const link = await CourseLocation.findById(req.params.id);
        if (!link) return res.status(404).json({ success: false, message: 'Course location not found' });
        const date = await CourseLocationDate.create({ courseLocationId: req.params.id, ...req.body });
        const dateObj = date.toObject ? date.toObject() : date;
        const mapped = mapDatesForClient([dateObj])[0];
        res.status(201).json({ success: true, data: mapped });
    } catch (error) {
        res.status(400).json({ success: false, message: error.message });
    }
};

// PUT /api/course-location-dates/:id
const updateDate = async (req, res) => {
    try {
        const date = await CourseLocationDate.findByIdAndUpdate(req.params.id, req.body, { new: true, runValidators: true });
        if (!date) return res.status(404).json({ success: false, message: 'Date not found' });
        const dateObj = date.toObject ? date.toObject() : date;
        const mapped = mapDatesForClient([dateObj])[0];
        res.json({ success: true, data: mapped });
    } catch (error) {
        res.status(400).json({ success: false, message: error.message });
    }
};

// DELETE /api/course-location-dates/:id
const deleteDate = async (req, res) => {
    try {
        await CourseLocationDate.findByIdAndDelete(req.params.id);
        res.json({ success: true, message: 'Date removed' });
    } catch (error) {
        res.status(500).json({ success: false, message: error.message });
    }
};

module.exports = {
    getAllCourseLocations, getCourseLocations, getCourseLocation, createCourseLocation,
    updateCourseLocation, deleteCourseLocation,
    addDate, updateDate, deleteDate
};
