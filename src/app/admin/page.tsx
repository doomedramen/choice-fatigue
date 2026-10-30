import { redirect } from "next/navigation";
import { getSession } from "@/lib/auth-session";
import AdminClient from "./admin-client";

export default async function AdminPage() {
  const session = await getSession();
  if (!session) redirect("/sign-in");
  if (session.user.role !== "admin") redirect("/");

  return <AdminClient userName={session.user.name} userId={session.user.id} />;
}
