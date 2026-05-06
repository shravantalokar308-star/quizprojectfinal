require('dotenv').config();
const { GoogleGenAI } = require('@google/genai');

const sampleText = `The sky is blue because of Rayleigh scattering.`;

async function run() {
    try {
        const ai = new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY });
        const response = await ai.models.generateContent({
            model: 'gemini-2.5-flash',
            contents: `Generate a JSON object with a question about this text: ${sampleText}`,
            config: {
                responseMimeType: "application/json",
            }
        });
        console.log("SUCCESS:", response.text);
    } catch (err) {
        console.error("TEST FAILED:");
        console.error(err);
    }
}
run();
