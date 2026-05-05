const express = require('express');
const router = express.Router();
const playerController = require('../controllers/playerController');
const { authMiddleware } = require('../config/jwt');

// All routes require authentication
router.use(authMiddleware);

router.post('/join', playerController.joinRoom);
router.get('/lobby/:roomId', playerController.lobbyView);
router.get('/game/:roomId', playerController.gameView);

module.exports = router;
