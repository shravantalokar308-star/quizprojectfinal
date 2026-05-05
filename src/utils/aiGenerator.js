const { GoogleGenAI } = require('@google/genai');
const OpenAI = require('openai');

const sleep = (ms) => new Promise(resolve => setTimeout(resolve, ms));

// Ollama client - assumes Ollama is running locally on port 11434
const ollama = new OpenAI({
    baseURL: 'http://localhost:11434/v1',
    apiKey: 'ollama', // Ollama doesn't need a real key but the SDK requires one
});

const aiGenerator = async (text, numQuestions = 5, difficulty = 'medium', timeLimit = 20) => {
    // Try Ollama first as it has no token limits and is local
    try {
        console.log('Attempting question generation with Ollama...');
        return await ollamaGenerator(text, numQuestions, difficulty, timeLimit);
    } catch (ollamaError) {
        console.warn('Ollama failed (is it running?), falling back to Gemini...', ollamaError.message);
    }

    const maxRetries = 3;
    let attempt = 0;

    while (attempt <= maxRetries) {
        try {
            if (!process.env.GEMINI_API_KEY || process.env.GEMINI_API_KEY === 'your_gemini_api_key_here') {
                throw new Error("GEMINI_API_KEY is missing in .env file.");
            }

            const client = new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY });
            
            const systemPrompt = `You are a quiz generator. Generate exactly ${numQuestions} questions from the text.
Return ONLY a JSON array of objects. 
Keys: "questionText", "options" (array of 4), "correctAnswer" (0-3), "timeLimit".`;

            const prompt = `Generate a quiz based on this text:\n\n${text}`;

            const fallbacks = ['gemini-2.5-flash', 'gemini-2.0-flash', 'gemini-2.5-pro', 'gemini-2.0-flash-lite'];
            const modelName = fallbacks[attempt] || fallbacks[0];

            const result = await client.models.generateContent({
                model: modelName,
                systemInstruction: systemPrompt,
                contents: [{ role: 'user', parts: [{ text: prompt }] }],
                config: {
                    responseMimeType: "application/json"
                }
            });

            let responseText = result.text.trim();
            
            console.log(`--- AI RAW RESPONSE (${modelName}) START ---`);
            console.log(responseText);
            console.log('--- AI RAW RESPONSE END ---');

            // Clean text if markdown crept in despite responseMimeType
            responseText = responseText.replace(/```json/g, '').replace(/```/g, '').trim();
            
            let data = JSON.parse(responseText);
            
            // Handle if AI returns { "questions": [...] } or similar
            let rawQuestions = Array.isArray(data) ? data : (data.questions || data.quiz || data.items || []);
            
            if (rawQuestions.length === 0) {
                throw new Error("AI returned an empty question list.");
            }

            return processQuestions(rawQuestions, numQuestions, timeLimit);

        } catch (error) {
            attempt++;
            
            const isRetryable = error.status === 503 || error.status === 429 || 
                               (error.message && (error.message.includes('503') || error.message.includes('429')));

            if (isRetryable && attempt <= maxRetries) {
                const waitTime = Math.pow(2, attempt) * 1000; 
                console.warn(`Gemini attempt ${attempt} failed. Retrying...`);
                await sleep(waitTime);
                continue;
            }

            // GEMINI FAILED - TRY DEEPSEEK FALLBACK
            console.log('Gemini failed or quota hit. Attempting DeepSeek fallback...');
            try {
                return await deepseekGenerator(text, numQuestions, difficulty, timeLimit);
            } catch (dsError) {
                console.warn('DeepSeek fallback failed, trying OpenAI...');
                try {
                    return await openaiGenerator(text, numQuestions, difficulty, timeLimit);
                } catch (oaError) {
                    console.error('All AI providers failed:', oaError);
                    throw oaError;
                }
            }
        }
    }
};

const deepseekGenerator = async (text, numQuestions, difficulty, timeLimit) => {
    if (!process.env.DEEPSEEK_API_KEY || process.env.DEEPSEEK_API_KEY === 'your_deepseek_api_key_here') {
        throw new Error("DeepSeek API Key is missing or invalid.");
    }

    const deepseek = new OpenAI({
        apiKey: process.env.DEEPSEEK_API_KEY,
        baseURL: 'https://api.deepseek.com'
    });

    const prompt = `You are a quiz generator. Generate exactly ${numQuestions} multiple choice questions from this text:
    
    ${text}

    Return ONLY a valid JSON array. Each object MUST have:
    - "questionText": string
    - "options": array of 4 strings
    - "correctAnswer": number (0-3)
    - "timeLimit": number (${timeLimit})`;

    const response = await deepseek.chat.completions.create({
        model: "deepseek-chat",
        messages: [{ role: "user", content: prompt }],
        response_format: { type: "json_object" }
    });

    let content = response.choices[0].message.content;
    let data = JSON.parse(content);
    let rawQuestions = Array.isArray(data) ? data : (data.questions || data.quiz || data.items || []);

    return processQuestions(rawQuestions, numQuestions, timeLimit);
};

const openaiGenerator = async (text, numQuestions, difficulty, timeLimit) => {
    if (!process.env.OPENAI_API_KEY || process.env.OPENAI_API_KEY === 'your_openai_api_key_here') {
        throw new Error("OpenAI API Key is missing or invalid.");
    }

    const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });

    const prompt = `You are a quiz generator. Generate exactly ${numQuestions} multiple choice questions from this text:
    
    ${text}

    Return ONLY a valid JSON array. Each object MUST have:
    - "questionText": string
    - "options": array of 4 strings
    - "correctAnswer": number (0-3)
    - "timeLimit": number (${timeLimit})`;

    const response = await openai.chat.completions.create({
        model: "gpt-4o-mini", // Cost-effective and fast
        messages: [{ role: "user", content: prompt }],
        response_format: { type: "json_object" }
    });

    let content = response.choices[0].message.content;
    let data = JSON.parse(content);
    let rawQuestions = Array.isArray(data) ? data : (data.questions || data.quiz || data.items || []);

    return processQuestions(rawQuestions, numQuestions, timeLimit);
};

const processQuestions = (rawQuestions, numQuestions, timeLimit) => {
    const finalQuestions = rawQuestions.map(q => ({
        questionText: q.questionText || q.question_text || q.question || q.text || "Untitled Question",
        options: q.options || q.choices || q.answers || ["A", "B", "C", "D"],
        correctAnswer: (typeof q.correctAnswer === 'number') ? q.correctAnswer : 0,
        timeLimit: q.timeLimit || q.time || timeLimit
    }));

    return finalQuestions.slice(0, numQuestions);
};


/**
 * Emergency Fallback: Generates simple questions from the text without using an API.
 * This ensures the user can ALWAYS create a room even if the AI is down or quota is hit.
 */
const generateLocalQuestions = (text, numQuestions, timeLimit) => {
    const sentences = text.split(/[.!?]/).map(s => s.trim()).filter(s => s.length > 20);
    const questions = [];

    for (let i = 0; i < Math.min(numQuestions, sentences.length); i++) {
        const sentence = sentences[i];
        const words = sentence.split(' ');
        if (words.length < 5) continue;

        // Create a simple "Fill in the blank" style question
        const missingWordIndex = Math.floor(words.length / 2);
        const missingWord = words[missingWordIndex].replace(/[,.;]/g, '');
        words[missingWordIndex] = "_______";
        
        const questionText = `Complete the sentence: "${words.join(' ')}"`;
        const options = [
            missingWord,
            "Incorrect Option A",
            "Incorrect Option B",
            "Incorrect Option C"
        ].sort(() => Math.random() - 0.5);

        questions.push({
            questionText,
            options,
            correctAnswer: options.indexOf(missingWord),
            timeLimit: timeLimit
        });
    }

    // Fill remaining if not enough sentences
    while (questions.length < numQuestions) {
        questions.push({
            questionText: `Offline Question ${questions.length + 1}: What is the main topic of this document?`,
            options: ["Option A", "Option B", "Option C", "Option D"],
            correctAnswer: 0,
            timeLimit: timeLimit
        });
    }

    return questions;
};

const ollamaGenerator = async (text, numQuestions, difficulty, timeLimit) => {
    const prompt = `You are a quiz generator. Generate exactly ${numQuestions} multiple choice questions from this text:
    
    ${text}

    Return ONLY a valid JSON array. Each object MUST have:
    - "questionText": string
    - "options": array of 4 strings
    - "correctAnswer": number (0-3)
    - "timeLimit": number (${timeLimit})`;

    const response = await ollama.chat.completions.create({
        model: "llama3", // Defaulting to llama3, user can change if needed
        messages: [{ role: "user", content: prompt }],
        response_format: { type: "json_object" }
    });

    let content = response.choices[0].message.content;
    let data = JSON.parse(content);
    let rawQuestions = Array.isArray(data) ? data : (data.questions || data.quiz || data.items || []);

    return processQuestions(rawQuestions, numQuestions, timeLimit);
};

module.exports = aiGenerator;


