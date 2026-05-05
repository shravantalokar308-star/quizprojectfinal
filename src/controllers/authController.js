const User = require('../models/User');
const jwt = require('jsonwebtoken');
const bcrypt = require('bcryptjs');

const generateToken = (userId, role, username) => {
    return jwt.sign({ userId, role, username }, process.env.JWT_SECRET, {
        expiresIn: '1d'
    });
};

exports.register = async (req, res) => {
    try {
        const { username, email, password } = req.body;
        
        const existingUser = await User.findOne({ $or: [{ email }, { username }] });
        if (existingUser) {
            return res.render('auth/register', { error: 'Username or Email already exists' });
        }

        const hashedPassword = await bcrypt.hash(password, 10);
        
        const user = new User({
            username,
            email,
            password: hashedPassword,
            role: 'user'
        });

        await user.save();

        const token = generateToken(user._id, user.role, user.username);
        res.cookie('token', token, { httpOnly: true });

        res.redirect('/dashboard');
    } catch (err) {
        console.error(err);
        res.render('auth/register', { error: 'An error occurred during registration.' });
    }
};

exports.login = async (req, res) => {
    try {
        const { email, password } = req.body;
        
        const user = await User.findOne({ email });
        if (!user) {
            return res.render('auth/login', { error: 'Invalid credentials' });
        }

        const isMatch = await bcrypt.compare(password, user.password);
        if (!isMatch) {
            return res.render('auth/login', { error: 'Invalid credentials' });
        }

        const token = generateToken(user._id, user.role, user.username);
        res.cookie('token', token, { httpOnly: true });

        res.redirect('/dashboard');
    } catch (err) {
        console.error(err);
        res.render('auth/login', { error: 'An error occurred during login.' });
    }
};

exports.logout = (req, res) => {
    res.clearCookie('token');
    res.redirect('/auth/login');
};

exports.googleCallback = async (req, res) => {
    try {
        const user = req.user;
        const token = generateToken(user._id, user.role, user.username);
        res.cookie('token', token, { httpOnly: true });
        res.redirect('/dashboard');
    } catch (err) {
        console.error('Google callback error:', err);
        res.redirect('/auth/login?error=Google authentication failed');
    }
};
