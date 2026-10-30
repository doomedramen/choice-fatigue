import "server-only";
import nodemailer, { type Transporter } from "nodemailer";

type AuthMessage = { to: string; subject: string; text: string };

function canUseConsoleDelivery() {
  return process.env.NODE_ENV === "development" && process.env.AUTH_EMAIL_MODE === "console";
}

let transporter: Transporter | undefined;

export async function sendAuthEmail(message: AuthMessage) {
  if (canUseConsoleDelivery()) {
    console.info(`[Choice Fatigue auth email: ${message.subject}] To: ${message.to}\n${message.text}`);
    return;
  }

  const smtpURL = process.env.SMTP_URL;
  const from = process.env.SMTP_FROM;
  if (process.env.AUTH_EMAIL_MODE !== "smtp" || !smtpURL || !from) {
    throw new Error("Authentication email is not configured.");
  }

  transporter ??= nodemailer.createTransport(smtpURL);
  await transporter.sendMail({ from, to: message.to, subject: message.subject, text: message.text });
}
