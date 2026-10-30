function required(name: string, value: string | undefined): string {
  if (!value) throw new Error(`Missing environment variable ${name}. See .env.example.`);
  return value;
}

export const env = {
  supabaseUrl: () => required('NEXT_PUBLIC_SUPABASE_URL', process.env.NEXT_PUBLIC_SUPABASE_URL),
  supabaseAnonKey: () => required('NEXT_PUBLIC_SUPABASE_ANON_KEY', process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY),
  serviceRoleKey: () => required('SUPABASE_SERVICE_ROLE_KEY', process.env.SUPABASE_SERVICE_ROLE_KEY),
  groqKey: () => required('GROQ_API_KEY', process.env.GROQ_API_KEY),
  groqModel: () => process.env.GROQ_MODEL || 'openai/gpt-oss-120b',
  /** low | medium | high — only used by reasoning models (openai/gpt-oss-*) */
  groqReasoningEffort: () => (process.env.GROQ_REASONING_EFFORT as 'low' | 'medium' | 'high' | undefined) || 'medium',
  telegramToken: () => process.env.TELEGRAM_BOT_TOKEN || '',
  telegramWebhookSecret: () => process.env.TELEGRAM_WEBHOOK_SECRET || '',
  cronSecret: () => process.env.CRON_SECRET || '',
  appUrl: () => process.env.NEXT_PUBLIC_APP_URL || 'http://localhost:3000',
};
