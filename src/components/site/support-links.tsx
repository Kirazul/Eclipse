import { useTranslations } from "next-intl";
import { Icon, type IconId } from "@/components/site/icons";
import { DISCORD_URL, GITHUB_URL, KOFI_URL } from "@/lib/site";

interface Way {
  href: string;
  icon: IconId;
  tone: string;
  label: string;
  short?: string;
  note: string;
}

const PAGE: Way[] = [
  { href: KOFI_URL, icon: "i-kofi", tone: "kofi", label: "Ko-fi", note: "kofi" },
  { href: GITHUB_URL, icon: "i-star", tone: "star", label: "star", note: "starNote" },
  { href: DISCORD_URL, icon: "i-discord", tone: "discord", label: "Discord", note: "discordNote" },
];

const DIALOG: Way[] = [
  { href: DISCORD_URL, icon: "i-discord", tone: "discord", label: "discordLabel", short: "Discord", note: "discordNote" },
  { href: KOFI_URL, icon: "i-kofi", tone: "kofi", label: "kofiLabel", short: "Ko-fi", note: "kofiNote" },
  { href: GITHUB_URL, icon: "i-star", tone: "star", label: "starLabel", short: "GitHub", note: "starNote" },
];

export function SupportLinks({ dialog = false }: { dialog?: boolean }) {
  const t = useTranslations("support");
  // Brand names stay as they are; the rest are messages.
  const say = (key: string) => (t.has(key as never) ? t(key as never) : key);
  return (dialog ? DIALOG : PAGE).map((w) => (
    <a key={w.href} className="slink" href={w.href} target="_blank" rel="noopener">
      <span className={`slink__icon slink__icon--${w.tone}`}><Icon id={w.icon} /></span>
      <span className="slink__text">
        <strong>
          {w.short ? (
            <>
              <span className="slink__full">{say(w.label)}</span>
              <span className="slink__short">{w.short}</span>
            </>
          ) : say(w.label)}
        </strong>
        <span>{say(w.note)}</span>
      </span>
      <Icon id="i-arrow" className="slink__arrow" />
    </a>
  ));
}
