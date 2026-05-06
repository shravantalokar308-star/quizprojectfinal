const { GoogleGenAI } = require('@google/genai');
const OpenAI = require('openai');

const sleep = (ms) => new Promise(resolve => setTimeout(resolve, ms));

// Ollama client - assumes Ollama is running locally on port 11434
const ollama = new OpenAI({
    baseURL: 'http://localhost:11434/v1',
    apiKey: 'ollama', // Ollama doesn't need a real key but the SDK requires one
});

const getSystemPrompt = (numQuestions, difficulty, timeLimit) => {
    return `You are a professional quiz generator. Generate exactly ${numQuestions} unique, clear, and high-quality multiple choice questions from the provided text.
Difficulty Level: ${difficulty.toUpperCase()}

Guidelines:
1. CLARITY: Questions must be unambiguous and easy to understand.
2. DIFFICULTY: Ensure questions strictly match the ${difficulty} difficulty level. 
   - Easy: Direct facts from text.
   - Medium: Requires some inference or connection of facts.
   - Hard: Deep understanding and application of concepts.
3. UNIQUENESS: Avoid duplicate questions or redundant options.
4. VARIETY: Cover different parts of the text.
5. FORMAT: Return ONLY a valid JSON array of objects.

Each object MUST have:
- "questionText": string
- "options": array of exactly 4 strings
- "correctAnswer": number (0-3)
- "timeLimit": number (${timeLimit})`;
};

const aiGenerator = async (text, numQuestions = 5, difficulty = 'medium', timeLimit = 20) => {
    const maxRetries = 2;
    let attempt = 0;

    // Try Gemini first as requested
    while (attempt <= maxRetries) {
        try {
            if (!process.env.GEMINI_API_KEY || process.env.GEMINI_API_KEY === 'your_gemini_api_key_here') {
                throw new Error("GEMINI_API_KEY is missing.");
            }

            const client = new GoogleGenAI(process.env.GEMINI_API_KEY);
            // Primary model is now gemini-2.5-flash as requested
            const fallbacks = ['gemini-2.5-flash', 'gemini-2.0-flash', 'gemini-1.5-flash'];
            const modelName = fallbacks[attempt] || fallbacks[0];
            const model = client.getGenerativeModel({ model: modelName });

            const systemPrompt = getSystemPrompt(numQuestions, difficulty, timeLimit);

            // Trim text to a reasonable length to avoid payload/token issues while keeping enough context
            const trimmedText = text.substring(0, 15000);
            console.log(`[AI Generator] Attempt ${attempt} with ${modelName}. Text length: ${trimmedText.length} chars.`);

            const prompt = `Text to process:\n\n${trimmedText}`;

            const result = await model.generateContent({
                contents: [{ role: 'user', parts: [{ text: prompt }] }],
                generationConfig: {
                    responseMimeType: "application/json",
                },
                systemInstruction: systemPrompt
            });

            const response = await result.response;
            let responseText = response.text().trim();
            
            console.log(`--- AI RAW RESPONSE (${modelName}) START ---`);
            // console.log(responseText); // Logged for debugging
            console.log('--- AI RAW RESPONSE END ---');

            // Robust JSON extraction
            const jsonMatch = responseText.match(/\[\s*\{.*\}\s*\]/s);
            if (jsonMatch) {
                responseText = jsonMatch[0];
            } else {
                responseText = responseText.replace(/```json/g, '').replace(/```/g, '').trim();
            }
            
            let data = JSON.parse(responseText);
            let rawQuestions = Array.isArray(data) ? data : (data.questions || data.quiz || data.items || []);
            
            if (rawQuestions.length === 0) throw new Error("Empty questions list");

            return processQuestions(rawQuestions, numQuestions, timeLimit);

        } catch (error) {
            console.error(`Gemini attempt ${attempt} failed:`, error.message);
            attempt++;
            
            if (attempt <= maxRetries) {
                const waitTime = Math.pow(2, attempt) * 1000; 
                await sleep(waitTime);
                continue;
            }

            // GEMINI FAILED - TRY OTHER PROVIDERS
            try {
                console.log('Gemini failed. Attempting Ollama fallback...');
                return await ollamaGenerator(text, numQuestions, difficulty, timeLimit);
            } catch (ollamaError) {
                try {
                    console.log('Ollama failed. Attempting DeepSeek fallback...');
                    return await deepseekGenerator(text, numQuestions, difficulty, timeLimit);
                } catch (dsError) {
                    try {
                        console.log('DeepSeek failed. Attempting OpenAI fallback...');
                        return await openaiGenerator(text, numQuestions, difficulty, timeLimit);
                    } catch (oaError) {
                        console.warn('All AI APIs failed. Using Emergency Local Generator.');
                        return generateLocalQuestions(text, numQuestions, timeLimit);
                    }
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

    const response = await deepseek.chat.completions.create({
        model: "deepseek-chat",
        messages: [
            { role: "system", content: getSystemPrompt(numQuestions, difficulty, timeLimit) },
            { role: "user", content: `Text to process:\n\n${text}` }
        ],
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

    const response = await openai.chat.completions.create({
        model: "gpt-4o-mini", // Cost-effective and fast
        messages: [
            { role: "system", content: getSystemPrompt(numQuestions, difficulty, timeLimit) },
            { role: "user", content: `Text to process:\n\n${text}` }
        ],
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
    const response = await ollama.chat.completions.create({
        model: "llama3", // Defaulting to llama3, user can change if needed
        messages: [
            { role: "system", content: getSystemPrompt(numQuestions, difficulty, timeLimit) },
            { role: "user", content: `Text to process:\n\n${text}` }
        ],
        response_format: { type: "json_object" }
    });

    let content = response.choices[0].message.content;
    let data = JSON.parse(content);
    let rawQuestions = Array.isArray(data) ? data : (data.questions || data.quiz || data.items || []);

    return processQuestions(rawQuestions, numQuestions, timeLimit);
};

module.exports = aiGenerator;


