require('dotenv').config();
const OpenAI = require('openai');

async function main() {
  const client = new OpenAI({
    apiKey: process.env.XAI_API_KEY,
    baseURL: process.env.XAI_BASE_URL,
  });

  console.log('Testing Grok API connection...');
  console.log('Model:', process.env.LLM_MODEL);
  console.log('Base URL:', process.env.XAI_BASE_URL);

  const response = await client.chat.completions.create({
    model: process.env.LLM_MODEL,
    max_tokens: 100,
    messages: [
      { role: 'system', content: 'You are a payment verification agent. Respond with valid JSON only.' },
      { role: 'user', content: 'Respond with: {"status": "connected", "model": "grok"}' },
    ],
  });

  console.log('\nResponse:', response.choices[0]?.message?.content);
  console.log('Tokens used:', response.usage?.total_tokens);
  console.log('\n✓ Grok API connection successful');
}

main().catch(err => {
  console.error('✗ Grok API connection failed:', err.message);
  process.exit(1);
});
