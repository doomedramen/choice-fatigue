import "server-only";
import nodemailer, { type Transporter } from "nodemailer";
import { getEnabledSmtpSettings } from "@/lib/global-settings";

type AuthMessage = { to: string; subject: string; text: string };

let transporter: Transporter | undefined;
let activeSmtpUrl: string | undefined;

export async function sendAuthEmail(message: AuthMessage) {
  if (process.env.E2E_NETWORK_ISOLATION === "1") throw new Error("Email delivery is disabled in browser tests.");
  const settings = await getEnabledSmtpSettings();
  if (!settings && process.env.NODE_ENV === "development") {
    console.info(`[Choice Fatigue auth email: ${message.subject}] To: ${message.to}\n${message.text}`);
    return;
  }
  if (!settings) {
    throw new Error("Authentication email is not configured.");
  }

  if (!transporter || activeSmtpUrl !== settings.smtpUrl) {
    transporter = nodemailer.createTransport(settings.smtpUrl);
    activeSmtpUrl = settings.smtpUrl;
  }
  await transporter.sendMail({ from: settings.smtpFrom, to: message.to, subject: message.subject, text: message.text });
}
