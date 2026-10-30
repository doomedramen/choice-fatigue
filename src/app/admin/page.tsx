import { redirect } from "next/navigation";
import { getSession } from "@/lib/auth-session";
import AdminClient from "./admin-client";

export default async function AdminPage({ searchParams }: { searchParams: Promise<{ [key: string]: string | string[] | undefined }> }) {
  const session = await getSession();
  if (!session) redirect("/sign-in");
  if (session.user.role !== "admin") redirect("/");

  const search = await searchParams;
  const section = Array.isArray(search.section) ? search.section[0] : search.section;
  const initialTab = section === "services" || section === "settings" || section === "users" ? section : "providers";
  return <AdminClient userName={session.user.name} userId={session.user.id} initialTab={initialTab} />;
}
