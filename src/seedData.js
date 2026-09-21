require('dotenv').config();
const mongoose = require('mongoose');

const Location = require('./models/Location');
const Course = require('./models/Course');
const CourseLocation = require('./models/CourseLocation');
const CourseLocationDate = require('./models/CourseLocationDate');
const License = require('./models/License');
const JobListing = require('./models/JobListing');
const JobApplication = require('./models/JobApplication');
const Booking = require('./models/Booking');
const Notification = require('./models/Notification');
const User = require('./models/User');

const seedData = async () => {
    try {
        await mongoose.connect(process.env.MONGODB_URI);
        console.log('Connected to MongoDB');

        console.log('Clearing old data (except users)...');
        await Location.deleteMany({});
        await Course.deleteMany({});
        await CourseLocation.deleteMany({});
        await CourseLocationDate.deleteMany({});
        await License.deleteMany({});
        await JobListing.deleteMany({});
        await JobApplication.deleteMany({});
        await Booking.deleteMany({});
        await Notification.deleteMany({});

        // Drop old SEO indexes that cause duplicate key errors because the fields are no longer in schema
        try { await Course.collection.dropIndex('seo.slug_1'); } catch (e) {}
        try { await License.collection.dropIndex('seo.slug_1'); } catch (e) {}

        // Fetch a user to use for bookings and applications (fallback if empty)
        let dummyUser = await User.findOne({});
        let userId = dummyUser ? dummyUser._id : new mongoose.Types.ObjectId();

        console.log('Seeding Locations...');
        const locations = await Location.insertMany([
            {
                name: 'London Training Centre',
                venueName: 'The Excel Center',
                addressLine1: '123 Training Road',
                city: 'London',
                postcode: 'E16 1XL',
                facilities: ['wifi', 'projector', 'disabled_access', 'toilets'],
                parking: true,
                status: 'Active'
            },
            {
                name: 'Manchester Hub',
                venueName: 'Manchester Conference Centre',
                addressLine1: '45 Hub Street',
                city: 'Manchester',
                postcode: 'M1 3BB',
                facilities: ['wifi', 'whiteboard', 'catering', 'air_conditioning'],
                parking: false,
                status: 'Active'
            },
            {
                name: 'Birmingham Academy',
                venueName: 'Birmingham Skills Space',
                addressLine1: '78 Academy Lane',
                city: 'Birmingham',
                postcode: 'B1 1AA',
                facilities: ['wifi', 'projector', 'prayer_room'],
                parking: true,
                status: 'Active'
            }
        ]);

        console.log('Seeding Courses...');
        const courses = await Course.insertMany([
            {
                title: 'Door Supervisor Course',
                category: 'SIA Training',
                subtitle: 'Level 2 Award for Working as a Door Supervisor',
                duration: '6 Days',
                shortDescription: 'Get your SIA Door Supervisor licence and work in pubs, clubs, retail, and events.',
                fullDescription: 'This comprehensive 6-day course covers everything from conflict management to physical intervention, ensuring you are fully prepared for your SIA licence application and a successful career in security.',
                pricing: { basePrice: 199.99, salePrice: 149.99 },
                status: 'Published',
                isPopular: true,
                seo: { slug: 'door-supervisor-course-1' }
            },
            {
                title: 'Emergency First Aid at Work',
                category: 'First Aid',
                subtitle: 'Level 3 Award in EFAW',
                duration: '1 Day',
                shortDescription: 'Essential first aid skills for the workplace.',
                fullDescription: 'Learn life-saving skills including CPR, dealing with choking, and managing minor injuries. Ideal for low-risk work environments.',
                pricing: { basePrice: 89.99 },
                status: 'Published',
                seo: { slug: 'emergency-first-aid-1' }
            },
            {
                title: 'CCTV Operator Course',
                category: 'SIA Training',
                subtitle: 'Level 2 Award for Working as a CCTV Operator (PSS)',
                duration: '3 Days',
                shortDescription: 'Train to become an SIA licensed CCTV operator.',
                fullDescription: 'Master the operation of CCTV equipment, understand the relevant laws, and learn how to report incidents effectively.',
                pricing: { basePrice: 179.99 },
                status: 'Published',
                seo: { slug: 'cctv-operator-course-1' }
            }
        ]);

        console.log('Seeding CourseLocations and Dates...');
        const futureDate1 = new Date(); futureDate1.setDate(futureDate1.getDate() + 10);
        const futureDate2 = new Date(); futureDate2.setDate(futureDate2.getDate() + 15);

        for (let i = 0; i < 3; i++) {
            const cl = await CourseLocation.create({
                courseId: courses[i]._id,
                locationId: locations[i]._id,
                price: courses[i].pricing.salePrice || courses[i].pricing.basePrice,
                status: 'Active'
            });

            await CourseLocationDate.create([
                {
                    courseLocationId: cl._id,
                    startDate: futureDate1,
                    endDate: new Date(futureDate1.getTime() + 86400000 * 3), // +3 days
                    availableSeats: 20
                },
                {
                    courseLocationId: cl._id,
                    startDate: futureDate2,
                    endDate: new Date(futureDate2.getTime() + 86400000 * 3), // +3 days
                    availableSeats: 20
                }
            ]);
        }

        console.log('Seeding Licenses...');
        await License.insertMany([
            {
                title: 'SIA Door Supervisor Licence',
                licenseType: 'Security Guard',
                category: 'SIA Training',
                shortDescription: 'The most popular SIA licence in the UK.',
                fullDescription: 'Allows you to work in pubs, clubs, events, and retail security.',
                pricing: { basePrice: 190.00 },
                status: 'Published',
                holderName: 'Jane Doe',
                email: 'jane@example.com'
            },
            {
                title: 'SIA CCTV Operator Licence',
                licenseType: 'Security Guard',
                category: 'SIA Training',
                shortDescription: 'Monitor CCTV systems legally.',
                fullDescription: 'Required for any public space surveillance role using CCTV.',
                pricing: { basePrice: 190.00 },
                status: 'Published',
                holderName: 'John Smith',
                email: 'john@example.com'
            },
            {
                title: 'Emergency First Aid Certificate',
                licenseType: 'First Aid',
                category: 'First Aid',
                shortDescription: 'Workplace first aid certification.',
                fullDescription: 'Valid for 3 years, fulfilling HSE requirements for low-risk workplaces.',
                pricing: { basePrice: 0 },
                status: 'Published',
                holderName: 'Alice Johnson',
                email: 'alice@example.com'
            }
        ]);

        console.log('Seeding JobListings...');
        const jobs = await JobListing.insertMany([
            {
                title: 'Retail Security Officer',
                company: 'Shield Security Ltd',
                location: 'London',
                type: 'Full-time',
                category: 'Security Officer',
                salary: '£24,000 - £28,000',
                description: 'We are looking for an experienced security officer for a premium retail store in central London.',
                status: 'Active'
            },
            {
                title: 'Event Door Supervisor',
                company: 'NightLife Secure',
                location: 'Manchester',
                type: 'Part-time',
                category: 'Door Supervisor',
                salary: '£15 - £18 per hour',
                description: 'Weekend door supervisors needed for busy city centre venues.',
                status: 'Active'
            },
            {
                title: 'CCTV Control Room Operator',
                company: 'CityWatch',
                location: 'Birmingham',
                type: 'Full-time',
                category: 'CCTV Operator',
                salary: '£26,000',
                description: 'Monitoring multiple sites from our state-of-the-art control room.',
                status: 'Active'
            }
        ]);

        console.log('Seeding JobApplications...');
        await JobApplication.insertMany([
            {
                user: userId,
                jobId: jobs[0]._id,
                jobTitle: jobs[0].title,
                firstName: 'Test',
                lastName: 'User 1',
                email: 'test1@example.com',
                phone: '07000000001',
                address: '123 Main St',
                city: 'London',
                postcode: 'SW1A 1AA',
                license: 'Yes, valid SIA',
                experience: '3 years',
                availability: 'Immediate',
                cover: 'I am very interested in this role.',
                status: 'Pending',
                applicationReference: 'REF-' + Math.floor(1000000 + Math.random() * 9000000)
            },
            {
                user: userId,
                jobId: jobs[1]._id,
                jobTitle: jobs[1].title,
                firstName: 'Test',
                lastName: 'User 2',
                email: 'test2@example.com',
                phone: '07000000002',
                address: '456 High St',
                city: 'Manchester',
                postcode: 'M1 1AA',
                license: 'Yes, valid SIA',
                experience: '1 year',
                availability: '2 weeks notice',
                cover: 'I have experience in similar venues.',
                status: 'Shortlisted',
                applicationReference: 'REF-' + Math.floor(1000000 + Math.random() * 9000000)
            },
            {
                user: userId,
                jobId: jobs[2]._id,
                jobTitle: jobs[2].title,
                firstName: 'Test',
                lastName: 'User 3',
                email: 'test3@example.com',
                phone: '07000000003',
                address: '789 Broad St',
                city: 'Birmingham',
                postcode: 'B1 1AA',
                license: 'Yes, valid SIA CCTV',
                experience: '5 years',
                availability: 'Immediate',
                cover: 'I am highly experienced with modern CCTV systems.',
                status: 'Interview',
                applicationReference: 'REF-' + Math.floor(1000000 + Math.random() * 9000000)
            }
        ]);

        console.log('Seeding Bookings...');
        await Booking.insertMany([
            {
                user: userId,
                course: courses[0]._id,
                courseModel: 'Course',
                packageName: 'Standard',
                customerDetails: { firstName: 'Booker', lastName: 'One', email: 'book1@example.com', phone: '07000000011' },
                totalAmount: 149.99,
                status: 'PAID',
                lifecycleStatus: 'Upcoming',
                bookingReference: 'GL-' + Math.floor(100000 + Math.random() * 900000)
            },
            {
                user: userId,
                course: courses[1]._id,
                courseModel: 'Course',
                packageName: 'Premium',
                customerDetails: { firstName: 'Booker', lastName: 'Two', email: 'book2@example.com', phone: '07000000022' },
                totalAmount: 89.99,
                status: 'PENDING',
                lifecycleStatus: 'Upcoming',
                bookingReference: 'GL-' + Math.floor(100000 + Math.random() * 900000)
            },
            {
                user: userId,
                course: courses[2]._id,
                courseModel: 'Course',
                packageName: 'Standard',
                customerDetails: { firstName: 'Booker', lastName: 'Three', email: 'book3@example.com', phone: '07000000033' },
                totalAmount: 179.99,
                status: 'PAID',
                lifecycleStatus: 'Completed',
                bookingReference: 'GL-' + Math.floor(100000 + Math.random() * 900000)
            }
        ]);

        console.log('Seeding Notifications...');
        await Notification.insertMany([
            { user: userId, title: 'Welcome', message: 'Welcome to Courses4Me!', type: 'system' },
            { user: userId, title: 'Booking Confirmed', message: 'Your booking for Door Supervisor has been confirmed.', type: 'booking' },
            { user: userId, title: 'Application Update', message: 'Your job application has been shortlisted.', type: 'user' }
        ]);

        console.log('Database seeded successfully!');
        process.exit(0);
    } catch (error) {
        console.error('Error seeding data:', error);
        process.exit(1);
    }
};

seedData();
