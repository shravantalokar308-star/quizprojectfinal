require('dotenv').config();
const aiGenerator = require('../src/utils/aiGenerator');

const sampleText = `
Object Storage stores data as separate units called objects. Each object contains the data itself, a unique identifier, and some extra information (metadata). 
It is highly scalable and is very useful in IoT because it can store large amounts of unstructured data like images, videos, and sensor data.
`;

async function run() {
    try {
        console.log("Starting test with Gemini API key:", process.env.GEMINI_API_KEY ? "Loaded" : "Missing");
        const questions = await aiGenerator(sampleText, 2, "easy", 20);
        console.log("SUCCESS:");
        console.log(JSON.stringify(questions, null, 2));
    } catch (err) {
        console.error("TEST FAILED:");
        console.error(err);
    }
}

run();
