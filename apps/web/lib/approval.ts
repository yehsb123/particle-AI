import { t, type Lang } from "./i18n";

/**
 * Why a capability is waiting on a person, in words.
 *
 * The card used to show only the capability id and a risk badge: the person was asked to decide
 * without being told what the question was. The runtime states the reason as a code so the words
 * can be theirs, and the two reasons are not interchangeable — a tool held back because nobody
 * has allowed its server is a different decision from one held back for being risky, and only
 * the first is answered by knowing which server it is.
 */
export function describeApprovalReason(
  approval: { reasonCode?: string; missingPermissions?: readonly string[] },
  lang: Lang,
): string {
  const code = typeof approval.reasonCode === "string" && approval.reasonCode ? approval.reasonCode : "risk_above_autonomy";
  const key = `approval_${code}`;
  const phrase = t(key, lang);
  // a reason nobody has written words for still says something rather than showing its own key
  return phrase === key ? code.replace(/[_-]/g, " ").trim() : phrase;
}

/** The ungranted permissions worth naming, in the order they were declared, without repeats. */
export function missingPermissionNames(approval: { missingPermissions?: readonly string[] }): string[] {
  const names: string[] = [];
  if (!Array.isArray(approval.missingPermissions)) return names;
  for (const raw of approval.missingPermissions) {
    const name = typeof raw === "string" ? raw.trim() : "";
    if (name && !names.includes(name)) names.push(name);
  }
  return names;
}
