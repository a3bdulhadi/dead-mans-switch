require("dotenv").config();

/**
 * Sends a real-time alert via Telegram Bot API if configured,
 * and always logs a structured alert banner to the console.
 */
async function sendAlert({ level, title, message }) {
  const timestamp = new Date().toISOString();
  const formatted = `[${timestamp}] [${level}] ${title}\n${message}`;

  console.log("\n==========================================");
  console.log(formatted);
  console.log("==========================================\n");

  const token = process.env.TELEGRAM_BOT_TOKEN;
  const chatId = process.env.TELEGRAM_CHAT_ID;

  if (!token || !chatId) {
    console.log("(Telegram credentials not set in agent/.env — logged locally only)");
    return { delivered: false, mode: "console" };
  }

  const url = `https://api.telegram.org/bot${token}/sendMessage`;
  const response = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      chat_id: chatId,
      text: `🚨 *${title}* [${level}]\n\n${message}`,
      parse_mode: "Markdown",
    }),
  });

  if (!response.ok) {
    const errText = await response.text();
    throw new Error(`Telegram API error (${response.status}): ${errText}`);
  }

  return { delivered: true, mode: "telegram" };
}

module.exports = { sendAlert };