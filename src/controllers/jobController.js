const JobListing = require('../models/JobListing');
const JobApplication = require('../models/JobApplication');
const User = require('../models/User');
const Notification = require('../models/Notification');
const sendEmail = require('../utils/sendEmail');

// ================= JOB LISTINGS =================

// @desc    Create new job listing
// @route   POST /api/jobs
// @access  Private/Admin
exports.createJobListing = async (req, res) => {
    try {
        const jobData = { ...req.body };
        if (typeof jobData.requirements === 'string') {
            try {
                jobData.requirements = JSON.parse(jobData.requirements);
            } catch (e) {
                jobData.requirements = jobData.requirements.split(',').map(r => r.trim()).filter(Boolean);
            }
        }
        
        const listing = await JobListing.create(jobData);
        res.status(201).json({
            success: true,
            data: listing,
            // standard client compatibility
            listing: listing
        });
    } catch (error) {
        res.status(400).json({
            success: false,
            message: error.message
        });
    }
};

// @desc    Get all job listings (public/admin)
// @route   GET /api/jobs
// @access  Public
exports.getJobListings = async (req, res) => {
    try {
        const { category, type, search, status } = req.query;
        let query = {};

        if (category) query.category = category;
        if (type) query.type = type;
        
        // Removed the strict 'Active' only filter for non-admins 
        // so the public portal can display 'Paused' and 'Closed' badges.
        if (status) {
            query.status = status;
        }

        if (search) {
            query.$or = [
                { title: { $regex: search, $options: 'i' } },
                { company: { $regex: search, $options: 'i' } },
                { description: { $regex: search, $options: 'i' } }
            ];
        }

        const listings = await JobListing.find(query).sort({ createdAt: -1 });

        res.status(200).json({
            success: true,
            listings: listings,
            // compatibility with different frontend services
            data: { listings: listings },
            count: listings.length
        });
    } catch (error) {
        res.status(500).json({
            success: false,
            message: error.message
        });
    }
};

// @desc    Get single job listing
// @route   GET /api/jobs/:id
// @access  Public
exports.getJobListingById = async (req, res) => {
    try {
        const listing = await JobListing.findById(req.params.id);
        if (!listing) {
            return res.status(404).json({
                success: false,
                message: 'Job listing not found'
            });
        }
        res.status(200).json({
            success: true,
            data: listing,
            listing: listing
        });
    } catch (error) {
        res.status(400).json({
            success: false,
            message: 'Invalid job listing ID format'
        });
    }
};

// @desc    Update job listing
// @route   PUT /api/jobs/:id
// @access  Private/Admin
exports.updateJobListing = async (req, res) => {
    try {
        const jobData = { ...req.body };
        if (typeof jobData.requirements === 'string') {
            try {
                jobData.requirements = JSON.parse(jobData.requirements);
            } catch (e) {
                jobData.requirements = jobData.requirements.split(',').map(r => r.trim()).filter(Boolean);
            }
        }

        const listing = await JobListing.findByIdAndUpdate(req.params.id, jobData, {
            new: true,
            runValidators: true
        });

        if (!listing) {
            return res.status(404).json({
                success: false,
                message: 'Job listing not found'
            });
        }

        res.status(200).json({
            success: true,
            data: listing,
            listing: listing
        });
    } catch (error) {
        res.status(400).json({
            success: false,
            message: error.message
        });
    }
};

// @desc    Delete job listing
// @route   DELETE /api/jobs/:id
// @access  Private/Admin
exports.deleteJobListing = async (req, res) => {
    try {
        const listing = await JobListing.findByIdAndDelete(req.params.id);
        if (!listing) {
            return res.status(404).json({
                success: false,
                message: 'Job listing not found'
            });
        }
        res.status(200).json({
            success: true,
            message: 'Job listing deleted successfully',
            data: listing
        });
    } catch (error) {
        res.status(400).json({
            success: false,
            message: error.message
        });
    }
};

// ================= JOB APPLICATIONS =================

// @desc    Submit application for a job
// @route   POST /api/jobs/apply/:id
// @access  Public
exports.submitJobApplication = async (req, res) => {
    try {
        const job = await JobListing.findById(req.params.id);
        if (!job) {
            return res.status(404).json({
                success: false,
                message: 'Job listing not found'
            });
        }

        const cleanEmail = req.body.email ? req.body.email.trim().toLowerCase() : '';

        // Check for existing application before creating a new one
        let existingQuery = { jobId: job._id };
        if (req.user) {
            existingQuery.user = req.user._id;
        } else if (cleanEmail) {
            existingQuery.email = { $regex: new RegExp('^' + cleanEmail.replace(/[-\/\\^$*+?.()|[\]{}]/g, '\\$&') + '$', 'i') };
        }
        
        const existingApp = await JobApplication.findOne(existingQuery);
        if (existingApp) {
            return res.status(400).json({
                success: false,
                message: 'You have already applied for this job listing.'
            });
        }

        let user = null;

        if (req.user) {
            user = req.user;
        } else if (cleanEmail) {
            user = await User.findOne({ email: { $regex: new RegExp('^' + cleanEmail.replace(/[-\/\\^$*+?.()|[\]{}]/g, '\\$&') + '$', 'i') } });
        }

        // If password is provided and user does not exist, auto register
        if (!user && req.body.password && cleanEmail) {
            user = await User.create({
                name: `${req.body.firstName} ${req.body.lastName}`,
                email: cleanEmail,
                phone: req.body.phone,
                password: req.body.password,
                role: 'customer',
                activityHistory: [{
                    action: 'Registration',
                    details: 'Account automatically created during first job application'
                }]
            });
        }

        const applicationData = {
            ...req.body,
            email: cleanEmail,
            jobId: job._id,
            jobTitle: job.title
        };

        if (user) {
            applicationData.user = user._id;

            // Log activity in user history
            try {
                user.activityHistory.push({
                    action: 'Job Application',
                    details: `Applied for: ${job.title} at ${job.company || 'Courses4Me'}`
                });
                await user.save({ validateBeforeSave: false });
            } catch (logErr) {
                console.error('Failed to log activity:', logErr);
            }
        }

        const application = await JobApplication.create(applicationData);
        
        // Ensure reference number is populated (self-healing fallback)
        if (!application.applicationReference) {
            const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789';
            let ref = 'REF-';
            for (let i = 0; i < 7; i++) {
                ref += chars.charAt(Math.floor(Math.random() * chars.length));
            }
            application.applicationReference = ref;
            await JobApplication.findByIdAndUpdate(application._id, { applicationReference: ref });
        }
        
        // Notify Admins
        try {
            const admins = await User.find({ role: { $in: ['admin', 'editor'] } });
            const notifications = admins.map(admin => ({
                user: admin._id,
                title: 'New Job Application',
                message: `New application for ${job.title} by ${req.body.firstName} ${req.body.lastName}`,
                type: 'user'
            }));
            await Notification.insertMany(notifications);
            console.log(`Created ${notifications.length} job application notifications for admins.`);
        } catch (notifErr) {
            console.error('Job Application Notification Error:', notifErr);
        }

        // Send Confirmation Email to Candidate
        try {
            const emailHtml = `
                <div style="font-family: 'Segoe UI', Tahoma, Geneva, Verdana, sans-serif; max-width: 600px; margin: 0 auto; padding: 20px; border: 1px solid #e0e0e0; border-radius: 12px; background-color: #ffffff;">
                    <div style="text-align: center; margin-bottom: 20px;">
                        <h1 style="color: #F8510C; margin: 0;">Application Received!</h1>
                        <p style="color: #666; font-size: 16px;">Thank you for your interest in joining Courses4Me</p>
                    </div>
                    
                    <div style="background-color: #f9f9f9; padding: 20px; border-radius: 8px; margin-bottom: 20px;">
                        <h3 style="margin-top: 0; color: #333; border-bottom: 2px solid #F8510C; padding-bottom: 8px;">Application Details</h3>
                        <table style="width: 100%; border-collapse: collapse;">
                            <tr>
                                <td style="padding: 8px 0; color: #666; font-weight: bold;">Reference Code:</td>
                                <td style="padding: 8px 0; color: #F8510C; font-weight: bold; text-align: right;">${application.applicationReference}</td>
                            </tr>
                            <tr>
                                <td style="padding: 8px 0; color: #666; font-weight: bold;">Position:</td>
                                <td style="padding: 8px 0; color: #333; text-align: right;">${job.title}</td>
                            </tr>
                            <tr>
                                <td style="padding: 8px 0; color: #666; font-weight: bold;">Company:</td>
                                <td style="padding: 8px 0; color: #333; text-align: right;">${job.company || 'Courses4Me'}</td>
                            </tr>
                            <tr>
                                <td style="padding: 8px 0; color: #666; font-weight: bold;">Applicant Name:</td>
                                <td style="padding: 8px 0; color: #333; text-align: right;">${application.firstName} ${application.lastName}</td>
                            </tr>
                            <tr>
                                <td style="padding: 8px 0; color: #666; font-weight: bold;">SIA License Status:</td>
                                <td style="padding: 8px 0; color: #333; text-align: right;">${application.license}</td>
                            </tr>
                            <tr>
                                <td style="padding: 8px 0; color: #666; font-weight: bold;">Experience Level:</td>
                                <td style="padding: 8px 0; color: #333; text-align: right;">${application.experience}</td>
                            </tr>
                        </table>
                    </div>

                    <div style="background-color: #FFF7F3; border-left: 4px solid #F8510C; padding: 15px; border-radius: 6px; margin-bottom: 20px;">
                        <h4 style="margin: 0 0 5px 0; color: #F8510C;">What happens next?</h4>
                        <p style="margin: 0; color: #555; font-size: 13.5px; line-height: 1.5;">Our recruitment team will review your details and CV. If your qualifications match our active requirements, we will contact you directly to schedule an interview. You can track your real-time application status anytime inside your Student Dashboard.</p>
                    </div>

                    <div style="text-align: center; margin-top: 30px; border-top: 1px solid #eee; padding-top: 20px;">
                        <p style="color: #888; font-size: 14px;">If you have any questions, please contact our support team.</p>
                        <p style="color: #888; font-size: 14px;">&copy; ${new Date().getFullYear()} Courses4Me. All rights reserved.</p>
                    </div>
                </div>
            `;

            await sendEmail({
                email: cleanEmail,
                subject: `Application Submitted Successfully - Reference: ${application.applicationReference}`,
                message: `Thank you for applying for the ${job.title} role! Reference: ${application.applicationReference}.`,
                html: emailHtml
            });
            console.log('Confirmation email sent successfully.');
        } catch (emailErr) {
            console.error('Job Application Email Sending Error:', emailErr);
        }

        res.status(201).json({
            success: true,
            data: application,
            refNumber: application.applicationReference,
            message: 'Application submitted successfully',
            user: user ? {
                _id: user._id,
                name: user.name,
                email: user.email,
                role: user.role
            } : null
        });
    } catch (error) {
        console.error('SUBMIT APPLICATION ERROR:', error);
        res.status(400).json({
            success: false,
            message: error.message
        });
    }
};

// @desc    Get logged in user's job applications
// @route   GET /api/jobs/my-applications
// @access  Private
exports.getMyJobApplications = async (req, res) => {
    try {
        const query = {
            $or: [
                { user: req.user._id }
            ]
        };

        if (req.user && req.user.email) {
            const emailRegex = new RegExp('^' + req.user.email.replace(/[-\/\\^$*+?.()|[\]{}]/g, '\\$&') + '$', 'i');
            query.$or.push({ email: emailRegex });
        }

        const applications = await JobApplication.find(query)
            .populate('jobId', 'title company location type salary description category')
            .sort({ createdAt: -1 });

        res.status(200).json({
            success: true,
            applications,
            count: applications.length
        });
    } catch (error) {
        res.status(500).json({
            success: false,
            message: error.message
        });
    }
};

// @desc    Get all job applications
// @route   GET /api/jobs/applications
// @access  Private/Admin
exports.getJobApplications = async (req, res) => {
    try {
        const { status, search } = req.query;
        let query = {};

        if (status) query.status = status;

        if (search) {
            query.$or = [
                { firstName: { $regex: search, $options: 'i' } },
                { lastName: { $regex: search, $options: 'i' } },
                { email: { $regex: search, $options: 'i' } },
                { jobTitle: { $regex: search, $options: 'i' } }
            ];
        }

        const applications = await JobApplication.find(query).sort({ createdAt: -1 });

        res.status(200).json({
            success: true,
            applications: applications,
            data: { applications: applications },
            count: applications.length
        });
    } catch (error) {
        res.status(500).json({
            success: false,
            message: error.message
        });
    }
};

// @desc    Update status of a job application
// @route   PUT /api/jobs/applications/:id/status
// @access  Private/Admin
exports.updateApplicationStatus = async (req, res) => {
    try {
        const { status, reason } = req.body;
        if (!['Pending', 'Shortlisted', 'Interview', 'Rejected', 'Accepted'].includes(status)) {
            return res.status(400).json({
                success: false,
                message: 'Invalid application status'
            });
        }

        const application = await JobApplication.findByIdAndUpdate(
            req.params.id,
            { status },
            { new: true }
        );

        if (!application) {
            return res.status(404).json({
                success: false,
                message: 'Job application not found'
            });
        }

        // Ensure reference number is populated (self-healing fallback)
        if (!application.applicationReference) {
            const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789';
            let ref = 'REF-';
            for (let i = 0; i < 7; i++) {
                ref += chars.charAt(Math.floor(Math.random() * chars.length));
            }
            application.applicationReference = ref;
            await JobApplication.findByIdAndUpdate(application._id, { applicationReference: ref });
        }

        // Send Status Update Email to Candidate
        try {
            const cleanEmail = application.email.trim().toLowerCase();
            const emailHtml = `
                <div style="font-family: 'Segoe UI', Tahoma, Geneva, Verdana, sans-serif; max-width: 600px; margin: 0 auto; padding: 20px; border: 1px solid #e0e0e0; border-radius: 12px; background-color: #ffffff;">
                    <div style="text-align: center; margin-bottom: 20px;">
                        <h1 style="color: ${status === 'Rejected' ? '#EF4444' : (status === 'Accepted' ? '#22C55E' : '#F8510C')}; margin: 0;">Application Update</h1>
                        <p style="color: #666; font-size: 16px;">An update has been made to your application status</p>
                    </div>
                    
                    <div style="background-color: #f9f9f9; padding: 20px; border-radius: 8px; margin-bottom: 20px;">
                        <h3 style="margin-top: 0; color: #333; border-bottom: 2px solid ${status === 'Rejected' ? '#EF4444' : '#F8510C'}; padding-bottom: 8px;">Status Summary</h3>
                        <table style="width: 100%; border-collapse: collapse;">
                            <tr>
                                <td style="padding: 8px 0; color: #666; font-weight: bold;">Reference Code:</td>
                                <td style="padding: 8px 0; color: #333; text-align: right; font-weight: bold;">${application.applicationReference || 'N/A'}</td>
                            </tr>
                            <tr>
                                <td style="padding: 8px 0; color: #666; font-weight: bold;">Position:</td>
                                <td style="padding: 8px 0; color: #333; text-align: right;">${application.jobTitle}</td>
                            </tr>
                            <tr>
                                <td style="padding: 8px 0; color: #666; font-weight: bold;">New Status:</td>
                                <td style="padding: 8px 0; text-align: right; font-weight: bold; color: ${status === 'Rejected' ? '#EF4444' : (status === 'Accepted' ? '#22C55E' : '#F8510C')};">${status}</td>
                            </tr>
                        </table>
                    </div>

                    ${reason ? `
                    <div style="background-color: ${status === 'Rejected' ? '#FEF2F2' : '#FFF7F3'}; border-left: 4px solid ${status === 'Rejected' ? '#EF4444' : '#F8510C'}; padding: 15px; border-radius: 6px; margin-bottom: 20px;">
                        <h4 style="margin: 0 0 5px 0; color: ${status === 'Rejected' ? '#EF4444' : '#F8510C'}; font-weight: bold;">Message from the Recruitment Team:</h4>
                        <p style="margin: 0; color: #555; font-size: 14px; line-height: 1.5; font-style: italic;">"${reason}"</p>
                    </div>
                    ` : ''}

                    <div style="background-color: #FFF7F3; border-left: 4px solid #F8510C; padding: 15px; border-radius: 6px; margin-bottom: 20px;">
                        <h4 style="margin: 0 0 5px 0; color: #F8510C;">What happens next?</h4>
                        <p style="margin: 0; color: #555; font-size: 13.5px; line-height: 1.5;">
                            ${status === 'Rejected' ? 'We appreciate the time you took to apply. We will keep your CV on file for future roles that match your skill set.' : 
                              status === 'Accepted' ? 'Congratulations! Our hiring team will reach out directly with contract agreements and onboarding instructions.' : 
                              status === 'Interview' ? 'Our recruitment coordinator will contact you shortly to schedule and confirm your interview slot.' : 
                              status === 'Shortlisted' ? 'Your profile has been marked as a top candidate! We are currently completing review cycles for all candidates.' : 
                              'Our team is actively reviewing your qualifications and CV.'}
                        </p>
                    </div>

                    <div style="text-align: center; margin-top: 30px; border-top: 1px solid #eee; padding-top: 20px;">
                        <p style="color: #888; font-size: 14px;">You can track your real-time status in your Courses4Me Student Dashboard.</p>
                        <p style="color: #888; font-size: 14px;">&copy; ${new Date().getFullYear()} Courses4Me. All rights reserved.</p>
                    </div>
                </div>
            `;

            await sendEmail({
                email: cleanEmail,
                subject: `Application Update [${status}] - Reference: ${application.applicationReference || 'N/A'}`,
                message: `An update has been made to your application for the ${application.jobTitle} position. New Status: ${status}.`,
                html: emailHtml
            });
            console.log('Status update email sent to candidate successfully.');
        } catch (emailErr) {
            console.error('Job Application Status Email Sending Error:', emailErr);
        }

        res.status(200).json({
            success: true,
            data: application,
            application: application
        });
    } catch (error) {
        res.status(400).json({
            success: false,
            message: error.message
        });
    }
};
