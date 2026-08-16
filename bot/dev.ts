// Runs the bot with long polling for local development —
// no public HTTPS URL or webhook needed. Start with: npm run bot:dev
// (make sure .env.local has TELEGRAM_BOT_TOKEN, Supabase and Google Cloud vars set)
import "dotenv/config";
import { getBot } from "../lib/bot";

async function main() {
  const bot = getBot();
  await bot.telegram.deleteWebhook().catch(() => {});
  console.log("Bot starting with long polling…");
  await bot.launch();
}

main().catch((err) => {
  console.error("Failed to start bot:", err);
  process.exit(1);
});

process.once("SIGINT", () => process.exit(0));
process.once("SIGTERM", () => process.exit(0));
