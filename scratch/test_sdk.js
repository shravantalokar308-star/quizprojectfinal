require('dotenv').config();
const { GoogleGenAI } = require('@google/genai');

async function run() {
    try {
        const ai = new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY });
        console.log("ai.models:", !!ai.models);
        console.log("Keys:", Object.keys(ai));
    } catch (err) {
        console.error(err);
    }
}
run();
