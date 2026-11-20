import { useTranslations } from "next-intl";
import Image from "next/image";
import Link from "next/link";

export default function NotFound() {
  const t = useTranslations("notFound");
  return (
    <main id="main" className="lost">
      <Image src="/assets/img/logo-320.webp" width={56} height={56} alt="Eclipse" unoptimized />
      <h1>{t("title")}</h1>
      <p>{t("body")}</p>
      <div className="cta">
        <Link className="btn btn--primary" href="/">{t("home")}</Link>
        <Link className="btn btn--ghost" href="/community-gallery">{t("gallery")}</Link>
      </div>
    </main>
  );
}
