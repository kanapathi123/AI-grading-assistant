const geminiConfig = {
  apiKey: process.env.NEXT_PUBLIC_GEMINI_API_KEY || '',
  model: process.env.NEXT_PUBLIC_GEMINI_MODEL || 'gemini-2.5-flash-lite',
  generationConfig: {
    temperature: 0.7,
    topP: 0.95,
    topK: 40,
    maxOutputTokens: 1024,
  },
};

export default geminiConfig;
