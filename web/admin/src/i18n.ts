/** i18n scaffold (#100): the panel ships English-first, but strings routed
 * through t() are extractable today — a Hindi catalog drops in without a
 * refactor. New shared strings should be added here, not inlined. */

export type Locale = "en" | "hi";

const CATALOGS: Record<Locale, Record<string, string>> = {
  en: {},                        // keys ARE the English copy
  hi: {
    "All systems normal": "सभी सिस्टम सामान्य",
    "Server unreachable": "सर्वर उपलब्ध नहीं",
    "Sign out": "साइन आउट",
    "Needs attention": "ध्यान चाहिए",
  },
};

let current: Locale = "en";

export function setLocale(l: Locale): void {
  current = l;
}

export function getLocale(): Locale {
  return current;
}

export function t(key: string): string {
  return CATALOGS[current][key] ?? key;
}
