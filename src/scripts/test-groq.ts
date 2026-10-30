import Groq from 'groq-sdk';
import * as dotenv from 'dotenv';
dotenv.config({ path: '.env.local', quiet: true });

const model = process.env.GROQ_MODEL || 'openai/gpt-oss-120b';
const groq = new Groq({ apiKey: process.env.GROQ_API_KEY });

groq.chat.completions
  .create({ model, messages: [{ role: 'user', content: 'Return {"status":"ContextFlow Ready"} as JSON.' }], response_format: { type: 'json_object' }, ...(model.startsWith('openai/gpt-oss') ? { reasoning_effort: 'low' as const, include_reasoning: false } : {}) })
  .then((r) => console.log(`✓ ${model}:`, r.choices[0]?.message?.content))
  .catch((e) => {
    console.error(`✗ Groq error (${model}):`, e.message);
    process.exit(1);
  });
