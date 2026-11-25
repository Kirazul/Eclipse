import { getTranslations } from "next-intl/server";
import { ArrowLeft } from "lucide-react";
import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { Decoder } from "@/components/decoder";
import { RemoveGameSet } from "@/components/game-sync";
import { HubTitle } from "@/components/hub";
import { ScreenshotThumb } from "@/components/screenshot-thumb";
import { SignInOptions } from "@/components/sign-in-dialog";
import { repository } from "@/lib/data";
import { screenshotUrl } from "@/lib/screenshots";

type Props = { params: Promise<{ id: string }> };

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations("hub");
  return { title: t("yourSet"), robots: { index: false, follow: false } };
}

// RLS answers: a set that is not the visitor's is a set that does not exist. The
// Decoder brings the breakdown, editing and the publish form, and publishing from
// here writes a new public look. The private set stays as it was.
export default async function SetPage({ params }: Props) {
  const t = await getTranslations("hub");
  const ts = await getTranslations("set");
  // Signed out, the database refuses the read outright: ask for the sign-in instead.
  if (!(await repository.getAccount())) {
    return (
      <main id="main" className="wrap flex flex-col gap-6 py-10">
        <HubTitle title={t("yourSet")} blurb={t("signInForSets")} />
        {repository.live && (
          <div className="max-w-sm">
            <SignInOptions />
          </div>
        )}
      </main>
    );
  }
  const set = await repository.getGameSet((await params).id);
  if (!set) notFound();
  return (
    <main id="main" className="wrap flex flex-col gap-6 py-10">
      <Link href="/loadouts" className="flex items-center gap-1.5 self-start text-sm text-ink-dim hover:text-ink">
        <ArrowLeft className="size-4" aria-hidden="true" />
        {ts("back")}
      </Link>
      <div className="flex items-start justify-between gap-3">
        <HubTitle title={set.name} blurb={t("privateSet")} />
        <RemoveGameSet id={set.id} name={set.name} after="/loadouts" />
      </div>
      {set.gallery.length > 0 && (
        // What the studio sent, where the player lands: the form holding it is below the breakdown.
        <section aria-label={ts("pictures")} className="flex flex-col gap-3 rounded-lg border border-amber/40 bg-amber/5 p-4">
          <p className="text-sm text-ink">
            {ts("sent", { count: set.gallery.length })}
          </p>
          <ul className="flex flex-wrap gap-2">
            {set.gallery.map((path, i) => (
              <li key={path} className="relative aspect-video w-40 overflow-hidden rounded-md border border-line">
                <ScreenshotThumb src={screenshotUrl(path)} alt={ts("pictureAlt", { index: i + 1 })} sizes="10rem" className="object-cover" />
              </li>
            ))}
          </ul>
          <a href="#publish" className="pill self-start">{ts("goToForm")}</a>
        </section>
      )}
      <Decoder initial={set.code} canPublish={repository.live} fromSet={{ id: set.id, name: set.name, className: set.className, race: set.race, gallery: set.gallery }} />
    </main>
  );
}
