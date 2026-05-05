const express = require('express');
const router = express.Router();
const { authMiddleware } = require('../config/jwt');
const Room = require('../models/Room');
const Quiz = require('../models/Quiz');
const User = require('../models/User');

router.get('/dashboard', authMiddleware, async (req, res) => {
    try {
        const userId = req.user.userId;
        // Stats for mini-display on dashboard
        const hostedCount = await Room.countDocuments({ hostId: userId });
        const playedCount = await Room.countDocuments({ 'players.userId': userId });
        const wonCount = await Room.countDocuments({
            'players.userId': userId,
            status: 'finished',
            $expr: {
                $eq: [
                    { $first: { $map: { input: { $sortArray: { input: '$players', sortBy: { score: -1 } } }, as: 'p', in: '$$p.userId' } } },
                    { $toObjectId: userId }
                ]
            }
        });
        res.render('dashboard/index', { user: req.user, stats: { hostedCount, playedCount, wonCount } });
    } catch (err) {
        console.error(err);
        res.render('dashboard/index', { user: req.user, stats: { hostedCount: 0, playedCount: 0, wonCount: 0 } });
    }
});

router.get('/profile', authMiddleware, async (req, res) => {
    try {
        const userId = req.user.userId;

        // Quizzes hosted by this user
        const hostedRooms = await Room.find({ hostId: userId, status: 'finished' })
            .populate('quizId', 'title difficulty')
            .sort({ createdAt: -1 })
            .lean();

        // Quizzes played by this user (not hosted)
        const playedRooms = await Room.find({
            'players.userId': userId,
            status: 'finished'
        }).populate('quizId', 'title difficulty').sort({ createdAt: -1 }).lean();

        // Determine wins (user has highest score in a finished room)
        const wonRooms = playedRooms.filter(room => {
            if (!room.players || room.players.length === 0) return false;
            const sorted = [...room.players].sort((a, b) => b.score - a.score);
            return sorted[0].userId.toString() === userId;
        });

        // Attach user's score to played rooms
        const playedWithScore = playedRooms.map(room => {
            const playerEntry = room.players.find(p => p.userId.toString() === userId);
            return { ...room, myScore: playerEntry ? playerEntry.score : 0 };
        });

        // Attach player count and winner to hosted rooms
        const hostedWithStats = hostedRooms.map(room => {
            const sorted = [...(room.players || [])].sort((a, b) => b.score - a.score);
            return { ...room, playerCount: room.players.length, topScore: sorted[0] ? sorted[0].score : 0 };
        });

        const userDoc = await User.findById(userId).lean();

        // Calculate Total Score
        const totalScore = playedWithScore.reduce((sum, room) => sum + room.myScore, 0);

        res.render('profile/index', {
            user: req.user,
            userDoc,
            hostedRooms: hostedWithStats,
            playedRooms: playedWithScore,
            wonRooms,
            stats: {
                hostedCount: hostedWithStats.length,
                playedCount: playedWithScore.length,
                wonCount: wonRooms.length,
                totalScore: totalScore
            }
        });
    } catch (err) {
        console.error(err);
        res.redirect('/dashboard');
    }
});

module.exports = router;
