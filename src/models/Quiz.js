const mongoose = require('mongoose');

const questionSchema = new mongoose.Schema({
    questionText: { type: String, required: true },
    options: [{ type: String, required: true }],
    correctAnswer: { type: Number, required: true }, // Index of the correct option (0-3)
    timeLimit: { type: Number, default: 20 } // Time in seconds
});

const quizSchema = new mongoose.Schema({
    hostId: {
        type: mongoose.Schema.Types.ObjectId,
        ref: 'User',
        required: true
    },
    title: {
        type: String,
        required: true
    },
    difficulty: {
        type: String,
        enum: ['easy', 'medium', 'hard', 'expert'],
        default: 'medium'
    },
    questions: [questionSchema]
}, { timestamps: true });

module.exports = mongoose.model('Quiz', quizSchema);
