import { getTranslations } from "next-intl/server";
import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { HubTitle } from "@/components/hub";
import { MountStage } from "@/components/viewer/mount-stage";
import { OPEN_GRAPH } from "@/lib/site";
import { getMount } from "@/lib/viewer/mounts";

type Props = { params: Promise<{ id: string }> };

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const mount = await getMount((await params).id);
  if (!mount) return {};
  const tm = await getTranslations("mounts");
  const title = tm("metaTitle", { name: mount.name });
  const description = tm("metaDescription", { name: mount.name, count: mount.variants.length });
  const path = `/mounts/${mount.id}`;
  return { title, description, alternates: { canonical: path }, openGraph: { ...OPEN_GRAPH, title: `${title} · Eclipse`, description, url: path } };
}

export default async function MountPage({ params }: Props) {
  const t = await getTranslations("hub");
  const tm = await getTranslations("mounts");
  const mount = await getMount((await params).id);
  if (!mount) notFound();
  return (
    <main id="main" className="wrap flex flex-col gap-5 py-10">
      <Link href="/mounts" className="text-sm text-ink-dim underline-offset-2 hover:text-ink hover:underline">{tm("allMounts")}</Link>
      <HubTitle title={mount.name} blurb={mount.flying ? t("flying") : t("ground")} />
      <MountStage mount={mount} />
    </main>
  );
}
