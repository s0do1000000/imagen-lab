import { Telegraf, Markup } from "telegraf";
import { message } from "telegraf/filters";
import { generateAndStore, editAndStore, DAILY_LIMIT } from "./generate-image";
import { setPendingPhoto, getPendingPhoto, clearPendingPhoto } from "./bot-session-store";

const APP_URL = process.env.NEXT_PUBLIC_APP_URL;

const WELCOME_TEXT = [
  "🎞 <b>Imagen Lab</b>",
  "",
  "Просто напишите мне текст прямо здесь, в чате — и я нарисую картинку.",
  "Например: <i>«лиса в осеннем лесу, мультяшный стиль»</i>",
  "",
  "Также умею редактировать фото: пришлите фотографию с подписью, что изменить, например <i>«сделай фон закатным»</i>.",
  "",
  "А если хочется выбирать стиль и пропорции кнопками — нажмите ниже, откроется полноценное приложение с галереей.",
  "",
  `Лимит: ${DAILY_LIMIT} картинок в сутки (генерация и редактирование считаются одинаково).`,
].join("\n");

const EDIT_HINT_TEXT = [
  "📸 Фото получил! Теперь напишите текстом, что нужно изменить.",
  "",
  "Примеры:",
  "• «сделай фон закатным»",
  "• «добавь очки»",
  "• «преврати в мультяшный стиль»",
  "• «убери людей на фоне»",
  "• «сделай чёрно-белым, кинематографично»",
  "",
  "Или отправьте /cancel, чтобы отменить.",
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
      { command: "cancel", description: "Отменить ожидающее редактирование фото" },
    ])
    .catch(() => {});

  bot.start(async (ctx) => {
    await ctx.reply(WELCOME_TEXT, { parse_mode: "HTML", ...openAppKeyboard() });
  });

  bot.help(async (ctx) => {
    await ctx.reply(WELCOME_TEXT, { parse_mode: "HTML", ...openAppKeyboard() });
  });

  bot.command("cancel", async (ctx) => {
    if (!ctx.from) return;
    await clearPendingPhoto(ctx.from.id);
    await ctx.reply("Отменено. Можете написать новый запрос.");
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

  // Any plain text: either an edit instruction (if a photo is pending for
  // this chat) or a fresh text-to-image prompt.
  bot.on(message("text"), async (ctx) => {
    const text = ctx.message.text.trim();
    if (!text || text.startsWith("/")) return;
    if (!ctx.from) return;

    const pendingFileId = await getPendingPhoto(ctx.from.id);
    if (pendingFileId) {
      await clearPendingPhoto(ctx.from.id);
      await runEdit(ctx, pendingFileId, text);
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
      ...openAppKeyboard(),
    });
  });

  bot.catch((err, ctx) => {
    console.error(`Bot error for update ${ctx.updateType}:`, err);
  });

  cached = bot;
  return bot;
}

// Shared photo-edit runner: downloads the Telegram file, calls the edit
// pipeline, and replies with the result — used both for photo+caption and
// for photo-then-text flows. Typed loosely on purpose: it's called from two
// different Telegraf update-type contexts (photo and text), and Telegraf's
// precise per-update Context types don't unify cleanly through a shared
// helper — this avoids that mismatch causing a build-time type error.
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
      ...openAppKeyboard(),
    });
  } catch (err) {
    console.error("runEdit failed:", err);
    await ctx.telegram
      .editMessageText(ctx.chat.id, statusMsg.message_id, undefined, "Не получилось скачать или обработать фото. Попробуйте ещё раз.")
      .catch(() => {});
  }
}
