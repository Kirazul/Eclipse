import { getTranslations } from "next-intl/server";
import type { Metadata } from "next";
import { HubTabs, HubTitle } from "@/components/hub";
import { MountGrid } from "@/components/viewer/mount-grid";
import { pageMetadata } from "@/lib/seo";
import { getMounts, toCard } from "@/lib/viewer/mounts";

export const metadata: Metadata = pageMetadata("/mounts");

export default async function MountsPage() {
  const t = await getTranslations("hub");
  const tm = await getTranslations("mounts");
  const mounts = (await getMounts()).map(toCard).sort((a, b) => a.name.localeCompare(b.name));
  return (
    <main id="main" className="wrap flex flex-col gap-5 py-10">
      <HubTitle title={t("mounts")} blurb={t("mountsBlurb")} />
      <HubTabs current="/mounts" />
      {mounts.length
        ? <MountGrid mounts={mounts} />
        : <p className="text-sm text-ink-dim">{tm("listFailed")}</p>}
    </main>
  );
}
