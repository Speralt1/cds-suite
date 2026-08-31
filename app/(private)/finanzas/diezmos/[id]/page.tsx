import { ProfilePage } from "@/components/finance/tithes/profile-page";
export default async function Page({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  return <ProfilePage id={id} />;
}
