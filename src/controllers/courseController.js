const Course = require('../models/Course');
const { enrichLocationsWithCoordinates } = require('../utils/geocodePostcode');

// @desc    Create new course
// @route   POST /api/courses
// @access  Private/Admin
exports.createCourse = async (req, res) => {
    try {
        let courseData = { ...req.body };

        // Parse stringified JSON fields from multipart/form-data
        const fieldsToParse = ['pricing', 'locations', 'sessions', 'instructor', 'highlights', 'learningPoints', 'targetAudience', 'requirements', 'guarantee'];
        fieldsToParse.forEach(field => {
            if (courseData[field] && typeof courseData[field] === 'string') {
                try {
                    courseData[field] = JSON.parse(courseData[field]);
                } catch (e) { }
            }
        });

        // Handle uploaded files
        if (req.files) {
            if (req.files.thumbnail) {
                courseData.thumbnail = req.files.thumbnail[0].path;
            }
            if (req.files.instructorPhoto) {
                if (!courseData.instructor) courseData.instructor = {};
                courseData.instructor.photo = req.files.instructorPhoto[0].path;
            }
        }

        if (courseData.locations?.length) {
            courseData.locations = await enrichLocationsWithCoordinates(courseData.locations);
        }

        const course = await Course.create(courseData);
        res.status(201).json({
            success: true,
            data: course
        });
    } catch (error) {
        res.status(400).json({
            success: false,
            message: error.message
        });
    }
};

// @desc    Get all courses
// @route   GET /api/courses
// @access  Public
exports.getCourses = async (req, res) => {
    try {
        const { category, status, search, location } = req.query;
        let query = {};

        if (category) query.category = category;

        // Default to Published for public users, allow specific status for admins
        if (status) {
            query.status = status;
        } else {
            // If not admin or if general public request, show only Published
            // We'll check for admin role if the request is authenticated
            const isAdmin = req.user && req.user.role === 'admin';
            if (!isAdmin) {
                query.status = 'Published';
            }
        }

        const filters = [];

        if (search) {
            filters.push({ $or: [
                { title: { $regex: search, $options: 'i' } },
                { shortDescription: { $regex: search, $options: 'i' } }
            ]});
        }

        if (location) {
            const loc = { $regex: location, $options: 'i' };
            filters.push({ $or: [
                { 'locations.name': loc },
                { 'locations.address': loc },
                { 'locations.postcode': loc }
            ]});
        }

        if (filters.length > 0) query.$and = filters;

        const courses = await Course.find(query).sort({ createdAt: -1 });

        const CourseLocation = require('../models/CourseLocation');
        const CourseLocationDate = require('../models/CourseLocationDate');

        const courseIds = courses.map(c => c._id);
        let links = await CourseLocation.find({ courseId: { $in: courseIds }, status: 'Active' }).lean();

        // Exclude links whose location has been disabled (Inactive) from the admin side —
        // otherwise a disabled location's scheduling still shows up in course listings.
        const Location = require('../models/Location');
        const activeLocationIds = new Set(
            (await Location.find({ status: 'Active' }).select('_id').lean())
                .map(l => l._id.toString())
        );
        links = links.filter(l => l.locationId && activeLocationIds.has(l.locationId.toString()));

        const dates = await CourseLocationDate.find({ courseLocationId: { $in: links.map(l => l._id) } }).lean();

        const datesByLink = {};
        dates.forEach(d => {
            if (!datesByLink[d.courseLocationId]) datesByLink[d.courseLocationId] = [];
            datesByLink[d.courseLocationId].push(d);
        });

        const sessionsByCourse = {};
        links.forEach(link => {
            if (!sessionsByCourse[link.courseId]) sessionsByCourse[link.courseId] = [];
            const linkDates = datesByLink[link._id] || [];
            linkDates.forEach(d => {
                const remaining = (d.availableSeats || 0) - (d.bookedSeats || 0);
                const status = remaining <= 0 ? 'Sold Out' : (remaining <= 5 ? 'Selling Fast' : 'Available');
                sessionsByCourse[link.courseId].push({
                    _id: d._id,
                    startDate: d.startDate,
                    endDate: d.endDate,
                    availabilityStatus: status
                });
            });
        });

        const coursesWithSessions = courses.map(course => {
            const courseObj = course.toObject();
            const legacySessions = courseObj.sessions || [];
            const newSessions = sessionsByCourse[course._id] || [];
            courseObj.sessions = [...legacySessions, ...newSessions];
            return courseObj;
        });

        res.status(200).json({
            success: true,
            count: coursesWithSessions.length,
            data: coursesWithSessions
        });
    } catch (error) {
        res.status(500).json({
            success: false,
            message: error.message
        });
    }
};

// @desc    Get single course
// @route   GET /api/courses/:id
// @access  Public
exports.getCourseById = async (req, res) => {
    try {
        let course = await Course.findById(req.params.id);

        if (!course) {
            const License = require('../models/License');
            const license = await License.findById(req.params.id);
            if (license) {
                // Find matching course by title keywords
                const titleLower = license.title.toLowerCase();
                // If the license is a Web Development licence, return it directly (no course lookup)
                if (titleLower.includes('web development')) {
                    course = license;
                } else {
                    // Dynamically map known licence titles to keyword searches
                    const keywordMap = [
                        "door supervisor",
                        "cctv",
                        "security guard",
                        "close protection",
                        "emergency first aid",
                        "first aid",
                        "fire marshal",
                        "manual handling",
                        "conflict management"
                    ];
                    let keyword = "";
                    for (const term of keywordMap) {
                        if (titleLower.includes(term)) {
                            keyword = term;
                            break;
                        }
                    }

                    if (keyword) {
                        const matchingCourse = await Course.findOne({
                            title: { $regex: keyword, $options: 'i' }
                        });
                        if (matchingCourse) {
                            course = matchingCourse;
                        }
                    }

                    // If no matching course was found, fall back to returning the license itself
                    if (!course) {
                        course = license;
                    }
            }
        }
        }
        if (!course) {
            return res.status(404).json({
                success: false,
                message: 'Course or License not found'
            });
        }

        // Check if course is published for public users
        const isAdmin = req.user && req.user.role === 'admin';
        if (!isAdmin && course.status && course.status !== 'Published' && course.status !== 'Active') {
            return res.status(403).json({
                success: false,
                message: 'This course/license is currently not available'
            });
        }

        res.status(200).json({
            success: true,
            data: course
        });
    } catch (error) {
        res.status(400).json({
            success: false,
            message: 'Invalid ID format'
        });
    }
};

// @desc    Update course
// @route   PUT /api/courses/:id
// @access  Private/Admin
exports.updateCourse = async (req, res) => {
    try {
        let updateData = { ...req.body };

        // Parse stringified JSON fields from multipart/form-data
        const fieldsToParse = ['pricing', 'locations', 'sessions', 'instructor', 'addOns', 'highlights', 'learningPoints', 'targetAudience', 'requirements', 'guarantee'];
        fieldsToParse.forEach(field => {
            if (updateData[field] && typeof updateData[field] === 'string') {
                try {
                    updateData[field] = JSON.parse(updateData[field]);
                } catch (e) { }
            }
        });

        // Handle uploaded files
        if (req.files) {
            if (req.files.thumbnail) {
                updateData.thumbnail = req.files.thumbnail[0].path;
            }
            if (req.files.instructorPhoto) {
                if (!updateData.instructor) updateData.instructor = {};
                updateData.instructor.photo = req.files.instructorPhoto[0].path;
            }
        }

        if (updateData.locations?.length) {
            updateData.locations = await enrichLocationsWithCoordinates(updateData.locations);
        }

        const course = await Course.findByIdAndUpdate(req.params.id, updateData, {
            new: true,
            runValidators: true
        });

        if (!course) {
            return res.status(404).json({
                success: false,
                message: 'Course not found'
            });
        }

        res.status(200).json({
            success: true,
            data: course
        });
    } catch (error) {
        res.status(400).json({
            success: false,
            message: error.message
        });
    }
};

// @desc    Get course count by category
// @route   GET /api/courses/stats/categories
// @access  Public
exports.getCategoryStats = async (req, res) => {
    try {
        const isAdmin = req.user && req.user.role === 'admin';
        const matchQuery = isAdmin ? {} : { status: 'Published' };

        const stats = await Course.aggregate([
            { $match: matchQuery },
            { $group: { _id: '$category', count: { $sum: 1 } } }
        ]);

        res.status(200).json({
            success: true,
            data: stats
        });
    } catch (error) {
        res.status(500).json({
            success: false,
            message: error.message
        });
    }
};

// @desc    Delete course
// @route   DELETE /api/courses/:id
// @access  Private/Admin
exports.deleteCourse = async (req, res) => {
    try {
        const course = await Course.findByIdAndDelete(req.params.id);

        if (!course) {
            return res.status(404).json({
                success: false,
                message: 'Course not found'
            });
        }

        res.status(200).json({
            success: true,
            data: {}
        });
    } catch (error) {
        res.status(400).json({
            success: false,
            message: error.message
        });
    }
};
