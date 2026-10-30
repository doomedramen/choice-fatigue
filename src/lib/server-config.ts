import "server-only";

export const serverConfig = Object.freeze({
  adultSectionEnabled: process.env.ADULT_SECTION_ENABLED === "true",
});
