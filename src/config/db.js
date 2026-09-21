const mongoose = require('mongoose');

const connectDB = async () => {
    try {
        const conn = await mongoose.connect(process.env.MONGODB_URI, {
            retryWrites: true,
            w: 'majority',
            connectTimeoutMS: 10000,
            socketTimeoutMS: 45000,
        });
        console.log(`MongoDB Connected: ${conn.connection.host}`);
        return conn;
    } catch (error) {
        console.error(`MongoDB Connection Error: ${error.message}`);
        console.error('Will retry connection on next request...');
        // Don't exit - app will still run and retry
        setTimeout(() => connectDB(), 5000);
    }
};

module.exports = connectDB;
