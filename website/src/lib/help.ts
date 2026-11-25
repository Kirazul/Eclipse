// The fixes players ask for most, one list for the guide page and the bot's /help.
// Every answer comes from Kira's own posts (the install steps, announcements and the
// 1.0.1 changelog) or the overlay's settings, never from guesswork. Text between
// backticks is a file, a setting line or a command: Discord shows it as code, and
// so does the guide.

import en from "@/i18n/messages/en.json";

// The text lives in src/i18n/messages (help.<id>), so each language has its own.
export const HELP_IDS = ["f2", "crash", "missing", "names"] as const;
export type HelpId = (typeof HELP_IDS)[number];

export interface HelpEntry {
  id: HelpId;
  question: string;
  answer: string;
}

/** The list in English. */
export const HELP: readonly HelpEntry[] = HELP_IDS.map((id) => ({ id, ...en.help[id] }));

/** Splits an answer into plain text and the parts written between backticks. */
export function helpParts(text: string): { text: string; code: boolean }[] {
  return text.split("`").map((part, i) => ({ text: part, code: i % 2 === 1 })).filter((p) => p.text);
}
