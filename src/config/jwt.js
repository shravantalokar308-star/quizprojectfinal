const jwt = require('jsonwebtoken');

const authMiddleware = (req, res, next) => {
    const token = req.cookies.token;

    if (!token) {
        return res.redirect('/auth/login');
    }

    try {
        const decoded = jwt.verify(token, process.env.JWT_SECRET);
        req.user = decoded;
        res.locals.user = decoded; // Make user available in all EJS templates
        next();
    } catch (err) {
        res.clearCookie('token');
        return res.redirect('/auth/login');
    }
};

const checkRole = (role) => {
    return (req, res, next) => {
        console.log("Checking role. User:", req.user, "Expected:", role);
        if (req.user && req.user.role === role) {
            next();
        } else {
            res.status(403).send(`Access denied. Your role: ${req.user ? req.user.role : 'undefined'}. Required role: ${role}`);
        }
    };
};

module.exports = { authMiddleware, checkRole };
