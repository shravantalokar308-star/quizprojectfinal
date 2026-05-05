const mongoose = require('mongoose');

const userSchema = new mongoose.Schema({
    username: {
        type: String,
        required: true,
        unique: true,
        trim: true
    },
    email: {
        type: String,
        required: true,
        unique: true,
        trim: true,
        lowercase: true
    },
    password: {
        type: String,
        required: false // Not required for Google OAuth users
    },
    googleId: {
        type: String,
        unique: true,
        sparse: true // Allows nulls while keeping uniqueness for non-nulls
    },
    role: {
        type: String,
        default: 'user'
    }
}, { timestamps: true });

module.exports = mongoose.model('User', userSchema);
