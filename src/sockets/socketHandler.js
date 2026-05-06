const Room = require('../models/Room');
const Quiz = require('../models/Quiz');

const activeGames = {};

module.exports = (io) => {
    io.on('connection', (socket) => {
        console.log('New client connected:', socket.id);

        socket.on('host_join', async ({ roomId, userId, username }) => {
            socket.join(roomId);
            const room = await Room.findOne({ roomId });
            
            if (!activeGames[roomId]) {
                activeGames[roomId] = {
                    players: [],
                    currentQuestion: -1,
                    timer: null,
                    timeLeft: 0,
                    phase: 'waiting', // waiting, question, results
                    quizData: null,
                    optionCounts: [0,0,0,0],
                    isAIChallenge: room ? room.isAIChallenge : false,
                    aiTimer: null
                };

                // Add AI player if it's an AI Challenge
                if (room && room.isAIChallenge) {
                    activeGames[roomId].players.push({
                        userId: 'ai-bot',
                        username: '🤖 QuizMaster AI',
                        socketId: 'ai-socket',
                        score: 0,
                        answers: {},
                        isAI: true
                    });

                    // Also add host as the human player
                    if (userId && username) {
                        activeGames[roomId].players.push({
                            userId,
                            username,
                            socketId: socket.id,
                            score: 0,
                            answers: {}
                        });
                    }
                }
            }
            const game = activeGames[roomId];
            socket.emit('room_state', {
                phase: game.phase,
                currentQuestion: game.currentQuestion,
                timeLeft: game.timeLeft,
                quizData: game.quizData ? {
                    questions: game.quizData.questions.map(q => ({
                        questionText: q.questionText,
                        options: q.options,
                        timeLimit: q.timeLimit
                    }))
                } : null,
                correctAnswer: game.phase === 'results' && game.quizData ? game.quizData.questions[game.currentQuestion].correctAnswer : null,
                optionCounts: game.optionCounts,
                players: game.players
            });
            console.log(`Host joined room: ${roomId}`);
        });

        socket.on('player_join', async ({ roomId, userId, username }) => {
            if (activeGames[roomId]) {
                const game = activeGames[roomId];
                
                // Check if player is disqualified
                const roomDoc = await Room.findOne({ roomId });
                if (roomDoc && roomDoc.disqualifiedPlayers && roomDoc.disqualifiedPlayers.includes(userId)) {
                    socket.emit('join_error', { message: 'You have been disqualified from this quiz for switching tabs.' });
                    return;
                }

                let player = game.players.find(p => p.userId === userId);
                
                // If game is not waiting AND player is not already in the room (reconnecting)
                if (game.phase !== 'waiting' && !player) {
                    socket.emit('join_error', { message: 'Game has already started.' });
                    return;
                }

                socket.join(roomId);
                if (!player) {
                    player = { userId, username, socketId: socket.id, score: 0, answers: {} };
                    game.players.push(player);
                } else {
                    player.socketId = socket.id;
                }
                
                // Send current state to the joining player
                socket.emit('room_state', {
                    phase: game.phase,
                    currentQuestion: game.currentQuestion,
                    timeLeft: game.timeLeft,
                    quizData: game.quizData ? {
                        questionText: game.quizData.questions[game.currentQuestion].questionText,
                        options: game.quizData.questions[game.currentQuestion].options,
                        timeLimit: game.quizData.questions[game.currentQuestion].timeLimit,
                        totalQuestions: game.quizData.questions.length
                    } : null,
                    correctAnswer: game.phase === 'results' && game.quizData ? game.quizData.questions[game.currentQuestion].correctAnswer : null,
                    playerScore: player.score,
                    hasAnswered: !!player.answers[game.currentQuestion],
                    selectedOption: player.answers[game.currentQuestion]?.selectedOption
                });

                io.to(roomId).emit('update_players', game.players);
            }
            console.log(`Player ${username} joined room: ${roomId}`);
        });

        socket.on('player_cheated', async ({ roomId, userId }) => {
            const game = activeGames[roomId];
            if (game) {
                // Remove from active list
                game.players = game.players.filter(p => p.userId !== userId);
                
                // Add to disqualified list in DB
                await Room.updateOne({ roomId }, { $addToSet: { disqualifiedPlayers: userId } });
                
                // Notify the player
                socket.emit('player_disqualified', { message: 'You have been disqualified for switching tabs/windows.' });
                
                // Notify others (update leaderboard/player count)
                io.to(roomId).emit('update_players', game.players);
                
                console.log(`Player ${userId} disqualified from room ${roomId}`);
            }
        });

        socket.on('start_quiz', async ({ roomId }) => {
            io.to(roomId).emit('quiz_started');
        });

        socket.on('host_ready', async ({ roomId }) => {
            const room = await Room.findOne({ roomId }).populate('quizId');
            if (room && activeGames[roomId]) {
                activeGames[roomId].quizData = room.quizId;
                activeGames[roomId].currentQuestion = 0;
                activeGames[roomId].optionCounts = [0,0,0,0];
                sendNextQuestion(roomId);
            }
        });

        socket.on('submit_answer', async ({ roomId, userId, questionIndex, selectedOption, timeTaken }) => {
            const game = activeGames[roomId];
            if (game && game.quizData && game.currentQuestion === questionIndex) {
                const question = game.quizData.questions[questionIndex];
                const isCorrect = (selectedOption === question.correctAnswer);
                
                let points = 0;
                if (isCorrect) {
                    // Precise server-side timing
                    const serverTimeTaken = (Date.now() - game.questionStartTime) / 1000;
                    const maxTime = question.timeLimit;
                    
                    // High-stakes time bonus: Base 200 + up to 800 bonus points
                    const timeBonus = Math.max(0, maxTime - serverTimeTaken) / maxTime;
                    points = 200 + Math.round(800 * timeBonus);
                }

                const player = game.players.find(p => p.userId === userId);
                if (player && !player.answers[questionIndex]) {
                    player.score += points;
                    player.answers[questionIndex] = { selectedOption, isCorrect, points };
                }
                
                // Send result back to THIS player only
                socket.emit('answer_result', {
                    isCorrect,
                    correctAnswer: question.correctAnswer,
                    selectedOption
                });
                
                game.optionCounts[selectedOption]++;
                io.to(roomId).emit('answer_submitted', { selectedOption });

                // AI Battle: Speed up AI slightly if player answered, but DON'T end early
                if (game.isAIChallenge) {
                    const aiPlayer = game.players.find(p => p.isAI);
                    if (aiPlayer && !aiPlayer.answers[game.currentQuestion]) {
                        // AI will still answer but we wait for timer to end phase
                        clearTimeout(game.aiTimer);
                        game.aiTimer = setTimeout(() => {
                            processAIAnswer(roomId); 
                        }, 800); 
                    }
                    return; // Skip the early exit check below
                }

                // If everyone has answered, end question early (Normal mode only)
                const allAnswered = game.players.every(p => p.answers[game.currentQuestion]);
                if (allAnswered && game.phase === 'question') {
                    clearInterval(game.timer);
                    game.timer = null;
                    game.phase = 'results';
                    const q = game.quizData.questions[game.currentQuestion];
                    const isLastQuestion = game.currentQuestion === game.quizData.questions.length - 1;
                    io.to(roomId).emit('question_end', { 
                        correctAnswer: q.correctAnswer,
                        leaderboard: [...game.players].sort((a,b) => b.score - a.score),
                        isLastQuestion
                    });
                }

                // Update DB async
                await Room.updateOne(
                    { roomId, "players.userId": userId },
                    { 
                        $inc: { "players.$.score": points },
                        $push: { "players.$.answers": { questionIndex, selectedOption, isCorrect, timeTaken } }
                    }
                );
            }
        });

        socket.on('next_question', ({ roomId }) => {
            const game = activeGames[roomId];
            if (game) {
                game.currentQuestion++;
                if (game.currentQuestion < game.quizData.questions.length) {
                    sendNextQuestion(roomId);
                } else {
                    finishQuiz(roomId);
                }
            }
        });

        socket.on('disconnect', () => {
            console.log('Client disconnected:', socket.id);
            // Handling disconnects robustly would require mapping socket.id to roomId
        });
        function sendNextQuestion(roomId) {
            const game = activeGames[roomId];
            const q = game.quizData.questions[game.currentQuestion];

            game.phase = 'question';
            game.optionCounts = [0,0,0,0];
            const questionData = {
                questionIndex: game.currentQuestion,
                questionText: q.questionText,
                options: q.options,
                timeLimit: q.timeLimit,
                totalQuestions: game.quizData.questions.length
            };

            game.questionStartTime = Date.now();
            io.to(roomId).emit('new_question', questionData);
            
            // AI Answering Logic
            if (game.isAIChallenge) {
                clearTimeout(game.aiTimer);
                const difficulty = game.quizData.difficulty || 'medium';
                
                // Determine AI response time and accuracy based on difficulty
                let minTime = 5, maxTime = 10, accuracy = 0.7;
                if (difficulty === 'easy') { minTime = 8; maxTime = 15; accuracy = 0.5; }
                else if (difficulty === 'medium') { minTime = 5; maxTime = 10; accuracy = 0.7; }
                else if (difficulty === 'hard') { minTime = 3; maxTime = 7; accuracy = 0.85; }
                else if (difficulty === 'expert') { minTime = 1; maxTime = 4; accuracy = 0.95; }
                
                const timeToAnswer = Math.min(q.timeLimit - 1, Math.floor(Math.random() * (maxTime - minTime + 1)) + minTime);
                
                game.aiTimer = setTimeout(() => {
                    processAIAnswer(roomId);
                }, timeToAnswer * 1000);
            }

            // Timer logic
            game.timeLeft = q.timeLimit || 20; 
            clearInterval(game.timer);
            
            // Emit initial timer state
            io.to(roomId).emit('timer_tick', { timeLeft: game.timeLeft });
            
            game.timer = setInterval(() => {
                game.timeLeft--;
                io.to(roomId).emit('timer_tick', { timeLeft: game.timeLeft });
                
                if (game.timeLeft <= 0) {
                    clearInterval(game.timer);
                    game.timer = null;
                    
                    // Force round end if time is up
                    if (game.phase === 'question') {
                        // In AI Battle, ensure AI has a choice recorded before ending
                        if (game.isAIChallenge) {
                            const aiPlayer = game.players.find(p => p.isAI);
                            if (aiPlayer && !aiPlayer.answers[game.currentQuestion]) {
                                // This will record an AI answer and we continue to end the phase
                                processAIAnswer(roomId);
                            }
                        }

                        game.phase = 'results';
                        const isLastQuestion = game.currentQuestion === game.quizData.questions.length - 1;
                        io.to(roomId).emit('question_end', { 
                            correctAnswer: q.correctAnswer,
                            leaderboard: [...game.players].sort((a,b) => b.score - a.score),
                            isLastQuestion
                        });
                    }
                }
            }, 1000);
        }

        async function finishQuiz(roomId) {
            const game = activeGames[roomId];
            if(game) {
                clearTimeout(game.aiTimer);
                io.to(roomId).emit('quiz_finished', {
                    leaderboard: game.players.sort((a,b) => b.score - a.score)
                });
                await Room.updateOne({ roomId }, { status: 'finished' });
                delete activeGames[roomId];
            }
        }
    });

    function processAIAnswer(roomId) {
        const game = activeGames[roomId];
        if (!game || game.phase !== 'question') return;

        const q = game.quizData.questions[game.currentQuestion];
        const difficulty = game.quizData.difficulty || 'medium';
        let accuracy = 0.7;
        if (difficulty === 'easy') accuracy = 0.5;
        else if (difficulty === 'medium') accuracy = 0.7;
        else if (difficulty === 'hard') accuracy = 0.85;
        else if (difficulty === 'expert') accuracy = 0.95;

        const isCorrect = Math.random() < accuracy;
        let selectedOption;
        if (isCorrect) {
            selectedOption = q.correctAnswer;
        } else {
            const wrongOptions = [0,1,2,3].filter(opt => opt !== q.correctAnswer);
            selectedOption = wrongOptions[Math.floor(Math.random() * wrongOptions.length)];
        }
        
        const aiPlayer = game.players.find(p => p.isAI);
        if (aiPlayer && !aiPlayer.answers[game.currentQuestion]) {
            // Calculate time bonus based on when AI answered
            const timeTaken = (Date.now() - game.questionStartTime) / 1000;
            let points = 0;
            if (isCorrect) {
                // High-stakes time bonus: Base 200 + up to 800 bonus points
                const timeBonus = Math.max(0, q.timeLimit - timeTaken) / q.timeLimit;
                points = 200 + Math.round(800 * timeBonus);
            }
            aiPlayer.score += points;
            aiPlayer.answers[game.currentQuestion] = { selectedOption, isCorrect, points };
            game.optionCounts[selectedOption]++;
            io.to(roomId).emit('answer_submitted', { selectedOption, isAI: true });

            // AI Battle: Check if everyone answered, but DON'T end early (wait for timer)
            if (game.isAIChallenge) return;

            // Check if everyone has answered (Normal mode only)
            const allAnswered = game.players.every(p => p.answers[game.currentQuestion]);
            if (allAnswered && game.phase === 'question') {
                clearInterval(game.timer);
                game.timer = null;
                game.phase = 'results';
                const isLastQuestion = game.currentQuestion === game.quizData.questions.length - 1;
                io.to(roomId).emit('question_end', { 
                    correctAnswer: q.correctAnswer,
                    leaderboard: game.players.sort((a,b) => b.score - a.score).slice(0, 5),
                    isLastQuestion
                });
            }
        }
    }
};
