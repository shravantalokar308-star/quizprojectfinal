const { GoogleGenAI } = require('@google/genai');
const OpenAI = require('openai');

const sleep = (ms) => new Promise(resolve => setTimeout(resolve, ms));

// Ollama client - assumes Ollama is running locally on port 11434
const ollama = new OpenAI({
    baseURL: 'http://localhost:11434/v1',
    apiKey: 'ollama', // Ollama doesn't need a real key but the SDK requires one
});

const getSystemPrompt = (numQuestions, difficulty, timeLimit) => {
    return `You are an expert Examination Paper Setter. Your task is to generate exactly ${numQuestions} high-quality, formal multiple choice questions (MCQs) based STRICTLY and ONLY on the provided text.

Difficulty Level: ${difficulty.toUpperCase()}

QUESTION TYPES TO INCLUDE (Mix them up):
- Conceptual Questions ("What is...", "How does...")
- Situational/Temporal ("When should...", "In which case...")
- Logical/Analytical ("Why is...", "Which of the following is TRUE/FALSE...")
- Identification ("Identify the correct...", "Which is NOT...", "Select the wrong one...")

STRICT RULES:
1. SOURCE GROUNDING: Every question and ALL 4 options must be derived directly from the information present in the text. Do NOT use outside knowledge.
2. EXAM QUALITY: Questions must follow a professional exam style—formal tone, clear phrasing, and unambiguous answers.
3. OPTION INTEGRITY: 
   - All 4 options must be plausible within the context of the text.
   - There must be exactly one correct answer.
   - Distractors (wrong options) should be related to the text content but clearly incorrect based on the specific question.
4. DIFFICULTY ADHERENCE:
   - EASY: Direct recall of facts mentioned in the text.
   - MEDIUM: Requires connecting two or more facts or basic inference from the text.
   - HARD/EXPERT: Requires deep conceptual understanding, synthesis of information, or complex reasoning based ONLY on the text.
5. NO REDUNDANCY: Ensure questions are unique and do not overlap in content.
6. FORMAT: Return ONLY a valid JSON array of objects.

JSON Structure:
{
  "questionText": "string",
  "options": ["option1", "option2", "option3", "option4"],
  "correctAnswer": 0-3,
  "timeLimit": ${timeLimit}
}`;
};

const aiGenerator = async (text, numQuestions = 5, difficulty = 'medium', timeLimit = 20, userApiKey = null) => {
    const maxRetries = 2;
    let attempt = 0;

    // Try Gemini first as requested
    while (attempt <= maxRetries) {
        try {
            const apiKeyToUse = userApiKey || process.env.GEMINI_API_KEY;
            
            if (!apiKeyToUse || apiKeyToUse === 'your_gemini_api_key_here') {
                throw new Error("GEMINI_API_KEY is missing. Please provide a valid API key.");
            }

            const ai = new GoogleGenAI({ apiKey: apiKeyToUse });
            const systemPrompt = getSystemPrompt(numQuestions, difficulty, timeLimit);
            
            // Ensure we use widely supported model names
            const fallbacks = ['gemini-2.5-flash', 'gemini-2.0-flash', 'gemini-1.5-flash'];
            const modelName = fallbacks[attempt] || fallbacks[0];

            // Trim text to a reasonable length
            const trimmedText = text.substring(0, 15000);
            console.log(`[AI Generator] Attempt ${attempt} with ${modelName}. Using User Key: ${!!userApiKey}. Text length: ${trimmedText.length} chars.`);

            const prompt = `Text to process:\n\n${trimmedText}`;

            const result = await ai.models.generateContent({
                model: modelName,
                contents: prompt,
                config: {
                    responseMimeType: "application/json",
                    systemInstruction: systemPrompt
                }
            });

            let responseText = result.text.trim();
            
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
 * Improved to look like formal exam questions without "Incorrect Option" labels.
 */
const generateLocalQuestions = (text, numQuestions, timeLimit) => {
    const sentences = text.split(/[.!?]/)
        .map(s => s.trim())
        .filter(s => s.length > 40 && s.length < 200);
    
    const questions = [];
    const usedSentences = new Set();

    for (let i = 0; i < sentences.length && questions.length < numQuestions; i++) {
        const sentence = sentences[i];
        if (usedSentences.has(sentence)) continue;

        const words = sentence.split(/\s+/);
        if (words.length < 8) continue;

        // Find a good noun or keyword to hide (longer words are usually better)
        const candidates = words.filter(w => w.length > 5 && !w.includes('"'));
        if (candidates.length === 0) continue;
        
        const answer = candidates[Math.floor(Math.random() * candidates.length)].replace(/[,.;:()]/g, '');
        const questionText = sentence.replace(answer, "_______");
        
        // Generate distractors from other sentences
        const distractors = sentences
            .filter(s => s !== sentence)
            .map(s => s.split(/\s+/).filter(w => w.length > 5 && w !== answer))
            .flat()
            .slice(0, 50)
            .sort(() => Math.random() - 0.5)
            .filter((v, i, a) => a.indexOf(v) === i) // Unique
            .slice(0, 3);

        // Fill in defaults if not enough distractors found
        while (distractors.length < 3) {
            distractors.push(["Concept", "Process", "System", "Data", "Analysis"][distractors.length]);
        }

        const options = [answer, ...distractors].sort(() => Math.random() - 0.5);

        questions.push({
            questionText: `Based on the text, fill in the blank: "${questionText}"`,
            options,
            correctAnswer: options.indexOf(answer),
            timeLimit: timeLimit
        });
        
        usedSentences.add(sentence);
    }

    // Last resort filler
    while (questions.length < numQuestions) {
        questions.push({
            questionText: "Which of the following best describes the main concept discussed in the document?",
            options: ["The primary subject matter", "A secondary detail", "An unrelated topic", "None of the above"],
            correctAnswer: 0,
            timeLimit: timeLimit
        });
    }

    return questions;
};

const ollamaGenerator = async (text, numQuestions, difficulty, timeLimit) => {
    try {
        const response = await ollama.chat.completions.create({
            model: "llama3",
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
    } catch (err) {
        console.error('Ollama Error:', err.message);
        throw err;
    }
};

module.exports = aiGenerator;


