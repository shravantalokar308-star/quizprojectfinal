require('dotenv').config();
const { GoogleGenAI } = require('@google/genai');

async function listModels() {
    try {
        const client = new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY });
        const result = await client.models.list();
        console.log('Result:', JSON.stringify(result, null, 2));
        if (result && result.models) {
            result.models.forEach(m => {
                console.log(`- ${m.name}`);
            });
        }
    } catch (error) {
        console.error('Error listing models:', error);
    }
}

listModels();
