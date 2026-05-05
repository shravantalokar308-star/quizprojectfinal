const express = require('express');
const http = require('http');
const socketIo = require('socket.io');
const mongoose = require('mongoose');
const dotenv = require('dotenv');
const cookieParser = require('cookie-parser');
const path = require('path');

dotenv.config();
const fs = require('fs');

const app = express();
app.set('trust proxy', 1);

// Ensure uploads directory exists
const uploadDir = path.join(__dirname, 'uploads');
if (!fs.existsSync(uploadDir)) {
    fs.mkdirSync(uploadDir);
}
const server = http.createServer(app);
const io = socketIo(server);

// Middleware
app.use(express.json());
app.use(express.urlencoded({ extended: true }));
app.use(cookieParser());
app.use(express.static(path.join(__dirname, 'src', 'public')));
const passport = require('./src/config/passport');
app.use(passport.initialize());

// View Engine
app.set('view engine', 'ejs');
app.set('views', path.join(__dirname, 'src', 'views'));

// Database Connection
mongoose.connect(process.env.MONGODB_URI || 'mongodb://localhost:27017/quizarena').then(() => {
    console.log('Connected to MongoDB');
}).catch((err) => {
    console.error('MongoDB connection error:', err);
});

// Socket.io Setup
require('./src/sockets/socketHandler')(io);

// Routes
app.use('/', require('./src/routes/indexRoutes'));
app.use('/auth', require('./src/routes/authRoutes'));
app.use('/host', require('./src/routes/hostRoutes'));
app.use('/player', require('./src/routes/playerRoutes'));

app.get('/', (req, res) => {
    res.redirect('/auth/login');
});

console.log('Starting server initialization...');

const PORT = process.env.PORT || 3000;
console.log(`Checking environment: PORT=${PORT}, MONGODB_URI=${process.env.MONGODB_URI ? 'Defined' : 'UNDEFINED'}`);

server.listen(PORT, () => {
    console.log(`Server is successfully running on port ${PORT}`);
});

process.on('unhandledRejection', (reason, promise) => {
    console.error('Unhandled Rejection at:', promise, 'reason:', reason);
});

process.on('uncaughtException', (err) => {
    console.error('Uncaught Exception thrown:', err);
    process.exit(1);
});
