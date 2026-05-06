require('dotenv').config();
const { GoogleGenAI } = require('@google/genai');

async function run() {
    try {
        const ai = new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY });
        const response = await ai.models.listModels();
        for await (const model of response) {
            console.log(model.name);
        }
    } catch (err) {
        console.error(err);
    }
}
run();
