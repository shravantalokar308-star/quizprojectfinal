const express = require('express');
const router = express.Router();
const hostController = require('../controllers/hostController');
const { authMiddleware } = require('../config/jwt');
const upload = require('../utils/upload');

// All routes require authentication
router.use(authMiddleware);

router.get('/create', hostController.createRoomView);
router.post('/create', upload.single('pdfFile'), hostController.createRoom);
router.get('/lobby/:roomId', hostController.lobbyView);
router.get('/game/:roomId', hostController.gameView);

// Settings for BYOK (Bring Your Own Key)
router.get('/settings', hostController.settingsView);
router.post('/settings', hostController.updateSettings);

module.exports = router;
