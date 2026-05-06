const Quiz = require('../models/Quiz');
const Room = require('../models/Room');
const User = require('../models/User');
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

        // Check Quota and API Key
        const user = await User.findById(req.user.userId);
        let userApiKey = user.geminiApiKey;
        
        if (!userApiKey) {
            const today = new Date().setHours(0, 0, 0, 0);
            const lastQuiz = user.lastQuizDate ? new Date(user.lastQuizDate).setHours(0, 0, 0, 0) : 0;
            
            if (lastQuiz === today) {
                if (user.dailyQuizCount >= 5) {
                    fs.unlinkSync(req.file.path); // Clean up
                    return res.render('host/create', { 
                        error: 'Daily Limit Reached: You can only generate 5 quizzes per day using our free AI. Please add your own Gemini API Key in Settings to generate unlimited quizzes.', 
                        query: req.query || {},
                        isAIChallenge: req.body.isAIChallenge === 'true'
                    });
                }
                user.dailyQuizCount += 1;
            } else {
                user.dailyQuizCount = 1;
                user.lastQuizDate = new Date();
            }
            await user.save();
        }

        // 1. Parse PDF
        const dataBuffer = fs.readFileSync(req.file.path);
        const data = await pdfParse(dataBuffer);
        const extractedText = data.text;

        // Clean up uploaded file
        fs.unlinkSync(req.file.path);

        // 2. Generate MCQs using AI
        const questions = await aiGenerator(extractedText, parseInt(numQuestions), difficulty, parseInt(timeLimit), userApiKey);

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

exports.settingsView = async (req, res) => {
    try {
        const user = await User.findById(req.user.userId);
        res.render('host/settings', { user, error: null, success: null });
    } catch (err) {
        res.redirect('/dashboard');
    }
};

exports.updateSettings = async (req, res) => {
    try {
        const { geminiApiKey } = req.body;
        const user = await User.findById(req.user.userId);
        
        user.geminiApiKey = geminiApiKey && geminiApiKey.trim() !== '' ? geminiApiKey.trim() : null;
        await user.save();
        
        res.render('host/settings', { user, error: null, success: 'Settings updated successfully!' });
    } catch (err) {
        console.error('Settings Update Error:', err);
        const user = await User.findById(req.user.userId);
        res.render('host/settings', { user, error: 'Failed to update settings.', success: null });
    }
};
