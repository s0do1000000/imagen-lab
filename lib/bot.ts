import { Telegraf, Markup } from "telegraf";
import { message } from "telegraf/filters";
import { after } from "next/server";
import { generateAndStore, editAndStore, videoAndStore, DAILY_LIMIT } from "./generate-image";
import {
  setPendingPhoto,
  getPendingPhoto,
  clearPendingPhoto,
  setAwaitingVideoPrompt,
  consumeAwaitingVideoPrompt,
} from "./bot-session-store";

const APP_URL = process.env.NEXT_PUBLIC_APP_URL;

const BTN_IMAGE = "🎨 Создать картинку";
const BTN_EDIT = "✏️ Изменить фото";
const BTN_VIDEO = "🎬 Видео";
const BTN_APP = "📱 Открыть приложение";

const WELCOME_TEXT = [
  "🎞 <b>Imagen Lab</b>",
  "",
  "Выберите кнопку внизу — или просто пишите текст, я пойму.",
  "",
  `Лимит: ${DAILY_LIMIT} в сутки (картинка, фото и видео считаются одинаково).`,
].join("\n");

const EDIT_HINT_TEXT = [
  "📸 Пришлите фото — с подписью, что изменить, или просто фото, и я спрошу отдельно.",
  "",
  "Примеры:",
  "• «сделай фон закатным»",
  "• «добавь очки»",
  "• «преврати в мультяшный стиль»",
  "• «убери людей на фоне»",
].join("\n");

const VIDEO_HINT_TEXT = [
  "🎬 Опишите видео — сцену, действие, стиль.",
  "",
  "Например: «дрон пролетает над океаном на закате, кинематографично»",
  "",
  "Генерация занимает 30–90 секунд, пришлю результат, как будет готово.",
].join("\n");

function keyboard() {
  const rows = [[BTN_IMAGE, BTN_EDIT], [BTN_VIDEO]];
  if (APP_URL) {
    return Markup.keyboard([...rows, [Markup.button.webApp(BTN_APP, APP_URL)]]).resize();
  }
  return Markup.keyboard(rows).resize();
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
      { command: "cancel", description: "Отменить ожидающее действие" },
    ])
    .catch(() => {});

  bot.start(async (ctx) => {
    await ctx.reply(WELCOME_TEXT, { parse_mode: "HTML", ...keyboard() });
  });

  bot.help(async (ctx) => {
    await ctx.reply(WELCOME_TEXT, { parse_mode: "HTML", ...keyboard() });
  });

  bot.command("cancel", async (ctx) => {
    if (!ctx.from) return;
    await clearPendingPhoto(ctx.from.id);
    await consumeAwaitingVideoPrompt(ctx.from.id);
    await ctx.reply("Отменено. Можете написать новый запрос.", keyboard());
  });

  // Photo sent to the bot: either edit immediately (if it has a caption)
  // or ask what to change and remember the photo for the next text message.
  bot.on(message("photo"), async (ctx) => {
    if (!ctx.from) return;

    const photos = ctx.message.photo;
    const largest = photos[photos.length - 1]; // Telegram sends smallest→largest
    const caption = ctx.message.caption?.trim();

    if (caption) {
      await runEdit(ctx, largest.file_id, caption);
      return;
    }

    await setPendingPhoto(ctx.from.id, largest.file_id);
    await ctx.reply(EDIT_HINT_TEXT);
  });

  // Any plain text: check the three keyboard buttons first, then pending
  // state (edit/video mode), then fall back to a fresh image generation.
  bot.on(message("text"), async (ctx) => {
    const text = ctx.message.text.trim();
    if (!text || text.startsWith("/")) return;
    if (!ctx.from) return;

    if (text === BTN_IMAGE) {
      await ctx.reply("Опишите, что нарисовать 🎨");
      return;
    }
    if (text === BTN_EDIT) {
      await ctx.reply(EDIT_HINT_TEXT);
      return;
    }
    if (text === BTN_VIDEO) {
      await setAwaitingVideoPrompt(ctx.from.id);
      await ctx.reply(VIDEO_HINT_TEXT);
      return;
    }

    const pendingFileId = await getPendingPhoto(ctx.from.id);
    if (pendingFileId) {
      await clearPendingPhoto(ctx.from.id);
      await runEdit(ctx, pendingFileId, text);
      return;
    }

    const awaitingVideo = await consumeAwaitingVideoPrompt(ctx.from.id);
    if (awaitingVideo) {
      await runVideo(ctx, text);
      return;
    }

    const statusMsg = await ctx.reply("🎨 Рисую...");
    const result = await generateAndStore(ctx.from, text);

    if (!result.ok) {
      const errorText =
        result.error === "limit_reached"
          ? `Лимит на сегодня исчерпан (${DAILY_LIMIT}/сутки). Попробуйте завтра 🙂`
          : `Не получилось сгенерировать картинку: ${result.message ?? "неизвестная ошибка"}`;
      await ctx.telegram.editMessageText(ctx.chat.id, statusMsg.message_id, undefined, errorText);
      return;
    }

    await ctx.telegram.deleteMessage(ctx.chat.id, statusMsg.message_id).catch(() => {});
    await ctx.replyWithPhoto(result.url, {
      caption: `Осталось сегодня: ${result.remaining}/${DAILY_LIMIT}`,
    });
  });

  bot.catch((err, ctx) => {
    console.error(`Bot error for update ${ctx.updateType}:`, err);
  });

  cached = bot;
  return bot;
}

// Shared photo-edit runner — typed loosely on purpose (see note on runVideo below).
// eslint-disable-next-line @typescript-eslint/no-explicit-any
async function runEdit(ctx: any, fileId: string, instruction: string) {
  if (!ctx.from) return;

  const statusMsg = await ctx.reply("🖌 Редактирую фото...");

  try {
    const fileUrl = await ctx.telegram.getFileLink(fileId);
    const fileRes = await fetch(fileUrl.toString());
    if (!fileRes.ok) throw new Error(`Failed to download photo: ${fileRes.status}`);
    const buffer = Buffer.from(await fileRes.arrayBuffer());

    const result = await editAndStore(ctx.from, instruction, {
      buffer,
      mimeType: "image/jpeg",
    });

    if (!result.ok) {
      const errorText =
        result.error === "limit_reached"
          ? `Лимит на сегодня исчерпан (${DAILY_LIMIT}/сутки). Попробуйте завтра 🙂`
          : `Не получилось отредактировать фото: ${result.message ?? "неизвестная ошибка"}`;
      await ctx.telegram.editMessageText(ctx.chat.id, statusMsg.message_id, undefined, errorText);
      return;
    }

    await ctx.telegram.deleteMessage(ctx.chat.id, statusMsg.message_id).catch(() => {});
    await ctx.replyWithPhoto(result.url, {
      caption: `Осталось сегодня: ${result.remaining}/${DAILY_LIMIT}`,
    });
  } catch (err) {
    console.error("runEdit failed:", err);
    await ctx.telegram
      .editMessageText(ctx.chat.id, statusMsg.message_id, undefined, "Не получилось скачать или обработать фото. Попробуйте ещё раз.")
      .catch(() => {});
  }
}

// Video generation takes 30s-2min — far too long to hold the Telegram
// webhook response open (Telegram may decide we failed and resend the same
// update, causing a duplicate generation). So we reply immediately that
// we've started, then do the actual polling in `after()` — Next.js/Vercel's
// mechanism for continuing work after the HTTP response has already been
// sent. The eventual result is delivered as a normal outbound Telegram API
// call (sendVideo), independent of our webhook response.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
async function runVideo(ctx: any, prompt: string) {
  if (!ctx.from) return;
  const user = ctx.from;
  const chatId = ctx.chat.id;
  const telegram = ctx.telegram;

  await ctx.reply("🎬 Начинаю генерацию видео, это займёт 30–90 секунд. Пришлю, как будет готово.");

  after(async () => {
    try {
      const result = await videoAndStore(user, prompt);

      if (!result.ok) {
        const errorText =
          result.error === "limit_reached"
            ? `Лимит на сегодня исчерпан (${DAILY_LIMIT}/сутки). Попробуйте завтра 🙂`
            : `Не получилось сгенерировать видео: ${result.message ?? "неизвестная ошибка"}`;
        await telegram.sendMessage(chatId, errorText);
        return;
      }

      await telegram.sendVideo(chatId, result.url, {
        caption: `Осталось сегодня: ${result.remaining}/${DAILY_LIMIT}`,
      });
    } catch (err) {
      console.error("runVideo background task failed:", err);
      await telegram.sendMessage(chatId, "Не получилось сгенерировать видео. Попробуйте ещё раз.").catch(() => {});
    }
  });
}
