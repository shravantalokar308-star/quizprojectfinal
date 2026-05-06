const mongoose = require('mongoose');

const roomSchema = new mongoose.Schema({
    roomId: {
        type: String,
        required: true,
        unique: true
    },
    hostId: {
        type: mongoose.Schema.Types.ObjectId,
        ref: 'User',
        required: true
    },
    quizId: {
        type: mongoose.Schema.Types.ObjectId,
        ref: 'Quiz',
        required: true
    },
    status: {
        type: String,
        enum: ['waiting', 'playing', 'finished'],
        default: 'waiting'
    },
    players: [{
        userId: {
            type: mongoose.Schema.Types.ObjectId,
            ref: 'User'
        },
        socketId: String,
        score: {
            type: Number,
            default: 0
        },
        answers: [{
            questionIndex: Number,
            selectedOption: Number,
            isCorrect: Boolean,
            timeTaken: Number
        }]
    }],
    currentQuestionIndex: {
        type: Number,
        default: -1
    },
    isAIChallenge: {
        type: Boolean,
        default: false
    },
    disqualifiedPlayers: [{
        type: mongoose.Schema.Types.ObjectId,
        ref: 'User'
    }]
}, { timestamps: true });

module.exports = mongoose.model('Room', roomSchema);
