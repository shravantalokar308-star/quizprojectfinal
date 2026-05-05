const Room = require('../models/Room');

exports.joinRoom = async (req, res) => {
    try {
        const { roomCode } = req.body;
        const roomId = roomCode.toUpperCase();

        const room = await Room.findOne({ roomId });
        
        if (!room) {
            return res.redirect('/dashboard?error=room_not_found');
        }
        
        if (room.status !== 'waiting') {
            return res.redirect('/dashboard?error=already_started');
        }

        // Add player to room if not already in it
        const isPlayerInRoom = room.players.some(p => p.userId.toString() === req.user.userId);
        if (!isPlayerInRoom) {
            room.players.push({
                userId: req.user.userId,
                score: 0,
                answers: []
            });
            await room.save();
        }

        res.redirect(`/player/lobby/${roomId}`);
    } catch (err) {
        console.error(err);
        res.status(500).send('Server Error. <a href="/dashboard">Go back</a>');
    }
};

exports.lobbyView = async (req, res) => {
    try {
        const roomId = req.params.roomId;
        const room = await Room.findOne({ roomId }).populate('quizId');
        
        if (!room) {
            return res.redirect('/dashboard');
        }

        res.render('player/lobby', { room, quiz: room.quizId });
    } catch (err) {
        console.error(err);
        res.redirect('/dashboard');
    }
};

exports.gameView = async (req, res) => {
    try {
        const roomId = req.params.roomId;
        const room = await Room.findOne({ roomId }).populate('quizId');
        
        if (!room) return res.redirect('/dashboard');

        res.render('player/game', { room, quiz: room.quizId, user: req.user });
    } catch (err) {
        console.error(err);
        res.redirect('/dashboard');
    }
};
