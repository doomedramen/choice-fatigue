import "dotenv/config";
import { PrismaPg } from "@prisma/adapter-pg";
import { PrismaClient } from "../src/generated/prisma/client";

const email = process.argv[2];
const databaseURL = process.env.DATABASE_URL;

if (!databaseURL) {
  throw new Error("DATABASE_URL is required. Set it in .env before promoting an administrator.");
}

if (!email || process.argv.length !== 3 || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
  throw new Error("Usage: npm run admin:promote -- exact-account-email@example.com");
}

async function promoteAdmin() {
  const prisma = new PrismaClient({ adapter: new PrismaPg({ connectionString: databaseURL }) });

  try {
    const user = await prisma.user.findUnique({ where: { email } });
    if (!user) throw new Error(`No existing account has the exact email address: ${email}`);
    if (user.role === "admin") {
      console.info(`${email} is already an administrator.`);
    } else {
      await prisma.user.update({ where: { id: user.id }, data: { role: "admin" } });
      console.info(`Promoted account ${email} to administrator.`);
    }
  } finally {
    await prisma.$disconnect();
  }
}

void promoteAdmin().catch(error => {
  console.error("Administrator promotion failed.", error);
  process.exitCode = 1;
});
