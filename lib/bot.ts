import { Telegraf, Markup } from "telegraf";
import { message } from "telegraf/filters";
import { generateAndStore, DAILY_LIMIT } from "./generate-image";

const APP_URL = process.env.NEXT_PUBLIC_APP_URL;

const WELCOME_TEXT = [
  "🎞 <b>Imagen Lab</b>",
  "",
  "Просто напишите мне текст прямо здесь, в чате — и я нарисую картинку.",
  "Например: <i>«лиса в осеннем лесу, мультяшный стиль»</i>",
  "",
  "А если хочется выбирать стиль и пропорции кнопками — нажмите ниже, откроется полноценное приложение с галереей.",
  "",
  `Лимит: ${DAILY_LIMIT} картинок в сутки.`,
].join("\n");

function openAppKeyboard() {
  if (!APP_URL) return undefined;
  return Markup.inlineKeyboard([[Markup.button.webApp("🎨 Открыть приложение", APP_URL)]]);
}

let cached: Telegraf | null = null;

export function getBot(): Telegraf {
  if (cached) return cached;

  const token = process.env.TELEGRAM_BOT_TOKEN;
  if (!token) throw new Error("TELEGRAM_BOT_TOKEN is not set.");

  const bot = new Telegraf(token);

  bot.telegram
    .setMyCommands([
      { command: "start", description: "Начать" },
      { command: "help", description: "Как этим пользоваться" },
    ])
    .catch(() => {});

  bot.start(async (ctx) => {
    await ctx.reply(WELCOME_TEXT, { parse_mode: "HTML", ...openAppKeyboard() });
  });

  bot.help(async (ctx) => {
    await ctx.reply(WELCOME_TEXT, { parse_mode: "HTML", ...openAppKeyboard() });
  });

  // Any plain text = a generation prompt.
  bot.on(message("text"), async (ctx) => {
    const prompt = ctx.message.text.trim();
    if (!prompt || prompt.startsWith("/")) return;
    if (!ctx.from) return;

    const statusMsg = await ctx.reply("🎨 Рисую...");

    const result = await generateAndStore(ctx.from, prompt);

    if (!result.ok) {
      const text =
        result.error === "limit_reached"
          ? `Лимит на сегодня исчерпан (${DAILY_LIMIT}/сутки). Попробуйте завтра 🙂`
          : `Не получилось сгенерировать картинку: ${result.message ?? "неизвестная ошибка"}`;
      await ctx.telegram.editMessageText(ctx.chat.id, statusMsg.message_id, undefined, text);
      return;
    }

    await ctx.telegram.deleteMessage(ctx.chat.id, statusMsg.message_id).catch(() => {});
    await ctx.replyWithPhoto(result.url, {
      caption: `Осталось сегодня: ${result.remaining}/${DAILY_LIMIT}`,
      ...openAppKeyboard(),
    });
  });

  bot.on(message("photo"), async (ctx) => {
    await ctx.reply("Пока я умею рисовать только по тексту — опишите словами, что нарисовать 🎨");
  });

  bot.catch((err, ctx) => {
    console.error(`Bot error for update ${ctx.updateType}:`, err);
  });

  cached = bot;
  return bot;
}
