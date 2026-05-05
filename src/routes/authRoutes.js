const express = require('express');
const router = express.Router();
const authController = require('../controllers/authController');

// Rendering Views
router.get('/login', (req, res) => {
    if (req.cookies.token) return res.redirect('/dashboard');
    res.render('auth/login', { error: null });
});

router.get('/register', (req, res) => {
    if (req.cookies.token) return res.redirect('/dashboard');
    res.render('auth/register', { error: null });
});

// API routes
router.post('/register', authController.register);
const passport = require('passport');
router.post('/login', authController.login);
router.get('/logout', authController.logout);

// Google OAuth Routes
router.get('/google', passport.authenticate('google', { scope: ['profile', 'email'] }));

router.get('/google/callback', 
    passport.authenticate('google', { session: false, failureRedirect: '/auth/login' }),
    authController.googleCallback
);

module.exports = router;
