import { Telegraf, Markup } from "telegraf";
import { message } from "telegraf/filters";
import { after } from "next/server";
import { generateAndStore, editAndStore, videoAndStore, getCreditBalance } from "./generate-image";
import {
  setPendingPhoto,
  getPendingPhoto,
  clearPendingPhoto,
  setAwaitingVideoPrompt,
  consumeAwaitingVideoPrompt,
} from "./bot-session-store";
import { PACKAGES, VIDEO_CREDIT_COST } from "./pricing";
import { createTonOrder } from "./orders";
import { supabaseServer } from "./supabase-server";

const APP_URL = process.env.NEXT_PUBLIC_APP_URL;

const BTN_IMAGE = "🎨 Создать картинку";
const BTN_EDIT = "✏️ Изменить фото";
const BTN_VIDEO = "🎬 Видео";
const BTN_BUY = "💎 Пополнить";
const BTN_APP = "📱 Открыть приложение";

function welcomeText(credits: number) {
  return [
    "🎞 <b>Imagen Lab</b>",
    "",
    "Выберите кнопку внизу — или просто пишите текст, я пойму.",
    "",
    "Первая картинка, первое фото и первое видео — бесплатно, дальше по вашему балансу.",
    "",
    `Баланс: <b>${credits}</b> генераций (видео стоит ${VIDEO_CREDIT_COST}).`,
  ].join("\n");
}

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
  `Стоит ${VIDEO_CREDIT_COST} генераций. Занимает 30–90 секунд, пришлю результат, как будет готово.`,
].join("\n");

function keyboard() {
  const rows = [[BTN_IMAGE, BTN_EDIT], [BTN_VIDEO, BTN_BUY]];
  if (APP_URL) {
    return Markup.keyboard([...rows, [Markup.button.webApp(BTN_APP, APP_URL)]]).resize();
  }
  return Markup.keyboard(rows).resize();
}

function insufficientCreditsText(remaining: number) {
  return [
    `Недостаточно генераций (осталось: ${remaining}).`,
    `Нажмите «${BTN_BUY}», чтобы пополнить баланс.`,
  ].join("\n");
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
      { command: "balance", description: "Баланс генераций" },
      { command: "buy", description: "Купить генераций" },
      { command: "cancel", description: "Отменить ожидающее действие" },
    ])
    .catch(() => {});

  bot.start(async (ctx) => {
    if (!ctx.from) return;
    const credits = await getCreditBalance(ctx.from.id);
    await ctx.reply(welcomeText(credits), { parse_mode: "HTML", ...keyboard() });
  });

  bot.help(async (ctx) => {
    if (!ctx.from) return;
    const credits = await getCreditBalance(ctx.from.id);
    await ctx.reply(welcomeText(credits), { parse_mode: "HTML", ...keyboard() });
  });

  bot.command("balance", async (ctx) => {
    if (!ctx.from) return;
    const credits = await getCreditBalance(ctx.from.id);
    await ctx.reply(`Баланс: ${credits} генераций.`);
  });

  bot.command("cancel", async (ctx) => {
    if (!ctx.from) return;
    await clearPendingPhoto(ctx.from.id);
    await consumeAwaitingVideoPrompt(ctx.from.id);
    await ctx.reply("Отменено. Можете написать новый запрос.", keyboard());
  });

  // Manual fallback for crediting a purchase — only for the bot owner
  // (set TELEGRAM_ADMIN_ID). Use this if the automatic USDT payment check
  // doesn't detect a real payment: verify it yourself (e.g. in a TON
  // explorer or your wallet app), then run this to credit the user.
  // Usage: /credit <telegram_id> <amount>
  bot.command("credit", async (ctx) => {
    const adminId = process.env.TELEGRAM_ADMIN_ID;
    if (!ctx.from || !adminId || String(ctx.from.id) !== adminId) return;

    const [, targetIdRaw, amountRaw] = ctx.message.text.trim().split(/\s+/);
    const targetId = Number(targetIdRaw);
    const amount = Number(amountRaw);

    if (!targetId || !amount) {
      await ctx.reply("Использование: /credit <telegram_id> <количество>");
      return;
    }

    const { data, error } = await supabaseServer().rpc("add_credits", {
      p_telegram_id: targetId,
      p_amount: amount,
    });

    if (error) {
      await ctx.reply(`Ошибка: ${error.message}`);
      return;
    }

    await ctx.reply(`Начислено ${amount} пользователю ${targetId}. Новый баланс: ${data}.`);
  });

  bot.command("buy", async (ctx) => showPackages(ctx));

  // ---- Purchases ----

  bot.action(/^buy_stars_(.+)$/, async (ctx) => {
    const pkg = PACKAGES.find((p) => p.id === ctx.match[1]);
    if (!pkg) return;
    await ctx.answerCbQuery();
    await ctx.telegram.sendInvoice(ctx.chat!.id, {
      title: pkg.label,
      description: `${pkg.credits} генераций для Imagen Lab`,
      payload: `credits_${pkg.id}`,
      provider_token: "", // empty string = pay with Telegram Stars, no external provider needed
      currency: "XTR",
      prices: [{ label: pkg.label, amount: pkg.stars }],
    });
  });

  bot.on("pre_checkout_query", async (ctx) => {
    await ctx.answerPreCheckoutQuery(true);
  });

  bot.on(message("successful_payment"), async (ctx) => {
    if (!ctx.from) return;
    const payload = ctx.message.successful_payment.invoice_payload; // "credits_p10"
    const pkgId = payload.replace("credits_", "");
    const pkg = PACKAGES.find((p) => p.id === pkgId);
    if (!pkg) return;

    const { data } = await supabaseServer().rpc("add_credits", {
      p_telegram_id: ctx.from.id,
      p_amount: pkg.credits,
    });
    await ctx.reply(`✅ Оплата получена! Начислено ${pkg.credits} генераций. Баланс: ${data}.`, keyboard());
  });

  bot.action(/^buy_ton_(.+)$/, async (ctx) => {
    const pkg = PACKAGES.find((p) => p.id === ctx.match[1]);
    if (!pkg || !ctx.from) return;
    await ctx.answerCbQuery();

    if (!process.env.TON_WALLET_ADDRESS || !APP_URL) {
      await ctx.reply("Оплата криптой пока не настроена.");
      return;
    }

    const order = await createTonOrder(ctx.from.id, pkg);
    const payUrl = `${APP_URL}/pay/${order.id}`;

    await ctx.reply(
      [
        `💎 Оплата ${pkg.usdtAmount} USDT за ${pkg.label}`,
        "",
        `Откройте страницу оплаты — там адрес кошелька, точная сумма и комментарий, который нужно указать при отправке:`,
        payUrl,
        "",
        "Страница сама подтвердит платёж через 10–30 секунд после отправки.",
      ].join("\n")
      // Deliberately a plain text link, not a web_app button — this keeps
      // the payment happening in the user's regular external browser, not
      // inside the Telegram app shell. See components/PayStatus.tsx.
    );
  });

  // ---- Photo → edit ----

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

  // ---- Text: buttons, pending state, or a fresh generation ----

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
    if (text === BTN_BUY) {
      await showPackages(ctx);
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
        result.error === "insufficient_credits"
          ? insufficientCreditsText(result.remaining ?? 0)
          : `Не получилось сгенерировать картинку: ${result.message ?? "неизвестная ошибка"}`;
      await ctx.telegram.editMessageText(ctx.chat.id, statusMsg.message_id, undefined, errorText);
      return;
    }

    await ctx.telegram.deleteMessage(ctx.chat.id, statusMsg.message_id).catch(() => {});
    await ctx.replyWithPhoto(result.url, { caption: `Осталось: ${result.remaining}` });
  });

  bot.catch((err, ctx) => {
    console.error(`Bot error for update ${ctx.updateType}:`, err);
  });

  cached = bot;
  return bot;
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
async function showPackages(ctx: any) {
  const buttons = PACKAGES.flatMap((pkg) => [
    [Markup.button.callback(`⭐ ${pkg.label} — ${pkg.stars} Stars`, `buy_stars_${pkg.id}`)],
    [Markup.button.callback(`💎 ${pkg.label} — ${pkg.usdtAmount} USDT`, `buy_ton_${pkg.id}`)],
  ]);
  await ctx.reply("Выберите пакет и способ оплаты:", Markup.inlineKeyboard(buttons));
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
        result.error === "insufficient_credits"
          ? insufficientCreditsText(result.remaining ?? 0)
          : `Не получилось отредактировать фото: ${result.message ?? "неизвестная ошибка"}`;
      await ctx.telegram.editMessageText(ctx.chat.id, statusMsg.message_id, undefined, errorText);
      return;
    }

    await ctx.telegram.deleteMessage(ctx.chat.id, statusMsg.message_id).catch(() => {});
    await ctx.replyWithPhoto(result.url, { caption: `Осталось: ${result.remaining}` });
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
          result.error === "insufficient_credits"
            ? insufficientCreditsText(result.remaining ?? 0)
            : `Не получилось сгенерировать видео: ${result.message ?? "неизвестная ошибка"}`;
        await telegram.sendMessage(chatId, errorText);
        return;
      }

      await telegram.sendVideo(chatId, result.url, { caption: `Осталось: ${result.remaining}` });
    } catch (err) {
      console.error("runVideo background task failed:", err);
      await telegram.sendMessage(chatId, "Не получилось сгенерировать видео. Попробуйте ещё раз.").catch(() => {});
    }
  });
}
