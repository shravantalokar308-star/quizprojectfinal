const Quiz = require('../models/Quiz');
const Room = require('../models/Room');
const pdfParse = require('pdf-parse');
const fs = require('fs');
const aiGenerator = require('../utils/aiGenerator');

const generateRoomId = () => {
    return Math.floor(100000 + Math.random() * 900000).toString();
};

exports.createRoomView = (req, res) => {
    res.render('host/create', { error: null, query: req.query });
};

exports.createRoom = async (req, res) => {
    try {
        const { title, numQuestions, timeLimit, difficulty } = req.body;
        
        if (!req.file) {
            return res.render('host/create', { error: 'Please upload a PDF file.' });
        }

        // 1. Parse PDF
        const dataBuffer = fs.readFileSync(req.file.path);
        const data = await pdfParse(dataBuffer);
        const extractedText = data.text;

        // Clean up uploaded file
        fs.unlinkSync(req.file.path);

        // 2. Generate MCQs using AI
        const questions = await aiGenerator(extractedText, parseInt(numQuestions), difficulty, parseInt(timeLimit));

        if (!questions || questions.length === 0) {
            return res.render('host/create', { error: 'Failed to generate questions from the provided PDF.' });
        }

        // 3. Create Quiz in DB
        const quiz = new Quiz({
            hostId: req.user.userId,
            title,
            difficulty,
            questions
        });
        await quiz.save();

        // 4. Create Room in DB
        const { isAIChallenge } = req.body;
        const roomId = generateRoomId();
        const room = new Room({
            roomId,
            hostId: req.user.userId,
            quizId: quiz._id,
            status: 'waiting',
            isAIChallenge: isAIChallenge === 'true'
        });
        await room.save();

        res.redirect(`/host/lobby/${roomId}`);
    } catch (err) {
        console.error('Room Creation Error:', err);
        let errorMessage = 'An error occurred while creating the quiz room.';
        
        // Handle Gemini Quota Error
        if (err.status === 429 || (err.message && err.message.includes('429'))) {
            errorMessage = 'AI Limit Reached: The daily free quota for Gemini AI has been exceeded. Please wait or try again later.';
        } else if (err.status === 503 || (err.message && err.message.includes('503'))) {
            errorMessage = 'AI Service Busy: The AI model is currently overloaded. Please try again in a few minutes.';
        } else {
            // Include actual error snippet for better debugging
            errorMessage = `Generation Error: ${err.message.substring(0, 100)}`;
        }

        res.render('host/create', { 
            error: errorMessage, 
            query: req.query || {},
            isAIChallenge: req.body.isAIChallenge === 'true'
        });
    }
};

exports.lobbyView = async (req, res) => {
    try {
        const roomId = req.params.roomId;
        const room = await Room.findOne({ roomId, hostId: req.user.userId }).populate('quizId');
        
        if (!room) {
            return res.redirect('/dashboard');
        }

        res.render('host/lobby', { room, quiz: room.quizId });
    } catch (err) {
        console.error(err);
        res.redirect('/dashboard');
    }
};

exports.gameView = async (req, res) => {
    try {
        const roomId = req.params.roomId;
        const room = await Room.findOne({ roomId, hostId: req.user.userId }).populate('quizId');
        
        if (!room) return res.redirect('/dashboard');

        if (room.status === 'waiting') {
            room.status = 'playing';
            room.currentQuestionIndex = 0;
            await room.save();
        }

        res.render('host/game', { room, quiz: room.quizId });
    } catch (err) {
        console.error(err);
        res.redirect('/dashboard');
    }
};
