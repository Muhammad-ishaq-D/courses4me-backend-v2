const License = require('../models/License');

// @desc    Create new license
// @route   POST /api/licenses
// @access  Private/Admin
exports.createLicense = async (req, res) => {
    try {
        let licenseData = { ...req.body };

        // Parse any stringified JSON fields from multipart/form-data if applicable
        const fieldsToParse = ['pricing', 'locations', 'instructor', 'highlights', 'learningPoints', 'requirements', 'applicationSteps', 'pricingBreakdown', 'relatedCourses'];
        fieldsToParse.forEach(field => {
            if (licenseData[field] && typeof licenseData[field] === 'string') {
                try {
                    licenseData[field] = JSON.parse(licenseData[field]);
                } catch (e) {}
            }
        });

        // Set holderName to title if not specified, and category defaults
        if (!licenseData.holderName && licenseData.title) {
            licenseData.holderName = licenseData.title;
        }

        const license = await License.create(licenseData);
        res.status(201).json({
            success: true,
            data: license
        });
    } catch (error) {
        res.status(400).json({
            success: false,
            message: error.message
        });
    }
};

// @desc    Get all licenses
// @route   GET /api/licenses
// @access  Public
exports.getLicenses = async (req, res) => {
    try {
        const { category, status, search, page = 1, limit = 10 } = req.query;
        let query = {};

        if (category) query.category = category;
        
        // Default to Published for public users, allow specific status for admins
        if (status) {
            query.status = status;
        } else {
            const isAdmin = req.user && req.user.role === 'admin';
            if (!isAdmin) {
                query.status = 'Published';
            }
        }

        if (search) {
            query.$or = [
                { title: { $regex: search, $options: 'i' } },
                { licenseNumber: { $regex: search, $options: 'i' } },
                { holderName: { $regex: search, $options: 'i' } },
                { licenseType: { $regex: search, $options: 'i' } }
            ];
        }

        const skip = (Number(page) - 1) * Number(limit);
        const total = await License.countDocuments(query);
        const licenses = await License.find(query)
            .sort({ createdAt: -1 })
            .skip(skip)
            .limit(Number(limit));

        res.status(200).json({
            success: true,
            licenses: licenses,
            total: total,
            page: Number(page),
            limit: Number(limit),
            // Standard format compatibility
            count: licenses.length,
            data: licenses
        });
    } catch (error) {
        res.status(500).json({
            success: false,
            message: error.message
        });
    }
};

// @desc    Get single license by ID or Slug
// @route   GET /api/licenses/:id
// @access  Public
exports.getLicenseById = async (req, res) => {
    try {
        const { id } = req.params;
        let license;

        if (id.match(/^[0-9a-fA-F]{24}$/)) {
            license = await License.findById(id).populate('relatedCourses');
        }

        if (!license) {
            return res.status(404).json({
                success: false,
                message: 'License not found'
            });
        }

        // Check if published for public users
        const isAdmin = req.user && req.user.role === 'admin';
        if (!isAdmin && license.status !== 'Published') {
            return res.status(403).json({
                success: false,
                message: 'This license is currently not available'
            });
        }

        res.status(200).json({
            success: true,
            data: license,
            // Backwards compatibility with endpoints expecting direct object
            ...license.toObject()
        });
    } catch (error) {
        res.status(400).json({
            success: false,
            message: 'Error fetching license'
        });
    }
};

// @desc    Update license
// @route   PUT /api/licenses/:id
// @access  Private/Admin
exports.updateLicense = async (req, res) => {
    try {
        let updateData = { ...req.body };

        // Parse any stringified JSON fields from multipart/form-data if applicable
        const fieldsToParse = ['pricing', 'locations', 'instructor', 'highlights', 'learningPoints', 'requirements', 'applicationSteps', 'pricingBreakdown', 'relatedCourses'];
        fieldsToParse.forEach(field => {
            if (updateData[field] && typeof updateData[field] === 'string') {
                try {
                    updateData[field] = JSON.parse(updateData[field]);
                } catch (e) {}
            }
        });

        const license = await License.findByIdAndUpdate(req.params.id, updateData, {
            new: true,
            runValidators: true
        });

        if (!license) {
            return res.status(404).json({
                success: false,
                message: 'License not found'
            });
        }

        res.status(200).json({
            success: true,
            data: license
        });
    } catch (error) {
        res.status(400).json({
            success: false,
            message: error.message
        });
    }
};

// @desc    Delete license
// @route   DELETE /api/licenses/:id
// @access  Private/Admin
exports.deleteLicense = async (req, res) => {
    try {
        const license = await License.findByIdAndDelete(req.params.id);

        if (!license) {
            return res.status(404).json({
                success: false,
                message: 'License not found'
            });
        }

        res.status(200).json({
            success: true,
            message: 'License deleted successfully',
            data: {}
        });
    } catch (error) {
        res.status(400).json({
            success: false,
            message: error.message
        });
    }
};
