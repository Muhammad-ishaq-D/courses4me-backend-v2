const Location = require('../models/Location');
const CourseLocation = require('../models/CourseLocation');

// GET /api/locations
const getLocations = async (req, res) => {
    try {
        const { search, status, page = 1, limit = 20 } = req.query;
        const query = {};

        if (search) {
            query.$or = [
                { name: { $regex: search, $options: 'i' } },
                { city: { $regex: search, $options: 'i' } },
                { postcode: { $regex: search, $options: 'i' } },
                { venueName: { $regex: search, $options: 'i' } }
            ];
        }
        if (status) query.status = status;

        const skip = (parseInt(page) - 1) * parseInt(limit);
        const [locations, total] = await Promise.all([
            Location.find(query).sort({ createdAt: -1 }).skip(skip).limit(parseInt(limit)).lean(),
            Location.countDocuments(query)
        ]);

        const locationIds = locations.map(l => l._id);
        const counts = await CourseLocation.aggregate([
            { $match: { locationId: { $in: locationIds }, status: 'Active' } },
            { $lookup: { from: 'courses', localField: 'courseId', foreignField: '_id', as: 'course' } },
            { $match: { 'course.status': 'Published' } },
            { $group: { _id: '$locationId', count: { $sum: 1 } } }
        ]);
        const countMap = {};
        counts.forEach(c => { countMap[c._id.toString()] = c.count; });

        const data = locations.map(l => ({
            ...l,
            linkedCoursesCount: countMap[l._id.toString()] || 0
        }));

        res.json({
            success: true,
            data,
            pagination: {
                total,
                page: parseInt(page),
                limit: parseInt(limit),
                pages: Math.ceil(total / parseInt(limit))
            }
        });
    } catch (error) {
        res.status(500).json({ success: false, message: error.message });
    }
};

// GET /api/locations/:id
const getLocationById = async (req, res) => {
    try {
        const location = await Location.findById(req.params.id).lean();
        if (!location) return res.status(404).json({ success: false, message: 'Location not found' });
        const linkedCoursesCount = await CourseLocation.countDocuments({ locationId: req.params.id });
        res.json({ success: true, data: { ...location, linkedCoursesCount } });
    } catch (error) {
        res.status(500).json({ success: false, message: error.message });
    }
};

// POST /api/locations
const createLocation = async (req, res) => {
    try {
        const location = await Location.create(req.body);
        res.status(201).json({ success: true, data: location });
    } catch (error) {
        res.status(400).json({ success: false, message: error.message });
    }
};

// PUT /api/locations/:id
const updateLocation = async (req, res) => {
    try {
        const location = await Location.findByIdAndUpdate(
            req.params.id,
            req.body,
            { new: true, runValidators: true }
        );
        if (!location) return res.status(404).json({ success: false, message: 'Location not found' });
        res.json({ success: true, data: location });
    } catch (error) {
        res.status(400).json({ success: false, message: error.message });
    }
};

// PATCH /api/locations/:id/status
const toggleStatus = async (req, res) => {
    try {
        const location = await Location.findById(req.params.id);
        if (!location) return res.status(404).json({ success: false, message: 'Location not found' });
        location.status = req.body.status || (location.status === 'Active' ? 'Inactive' : 'Active');
        await location.save();
        res.json({ success: true, data: location });
    } catch (error) {
        res.status(500).json({ success: false, message: error.message });
    }
};

// GET /api/locations/:id/courses
const getLinkedCourses = async (req, res) => {
    try {
        const links = await CourseLocation.find({ locationId: req.params.id })
            .populate('courseId', 'title category status thumbnail')
            .lean();
        res.json({ success: true, data: links });
    } catch (error) {
        res.status(500).json({ success: false, message: error.message });
    }
};

module.exports = { getLocations, getLocationById, createLocation, updateLocation, toggleStatus, getLinkedCourses };
