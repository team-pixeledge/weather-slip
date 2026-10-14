// Warning banner from 80% of the month's prints (Orders and Plans pages).

export interface UsageInfo {
  used: number;
  limit: number;
  pct: number;
  resetsAt: string;
  canUpgrade: boolean;
}

const fmtDate = (iso: string) =>
  new Date(iso).toLocaleDateString(undefined, { day: "numeric", month: "short", year: "numeric" });

/** `onUpgrade` replaces the link to the Plans page (used on the Plans page itself). */
export function UsageBanner({ usage, onUpgrade }: { usage: UsageInfo; onUpgrade?: () => void }) {
  if (usage.pct < 80) return null;
  const full = usage.used >= usage.limit;
  const upgrade = usage.canUpgrade && (
    <s-button slot="secondary-actions" {...(onUpgrade ? { onClick: onUpgrade } : { href: "/app/plans" })}>
      Upgrade
    </s-button>
  );
  return full ? (
    <s-banner tone="critical" heading="You've reached this month's print limit">
      All {usage.limit.toLocaleString()} prints in your plan are used. Slips — reprints included —
      print without weather until {fmtDate(usage.resetsAt)}.
      {upgrade}
    </s-banner>
  ) : (
    <s-banner tone="warning" heading={`You've used ${usage.pct}% of this month's prints`}>
      {usage.used.toLocaleString()} of {usage.limit.toLocaleString()} prints with weather ·
      resets {fmtDate(usage.resetsAt)}.{usage.canUpgrade ? " Upgrade to avoid running out." : ""}
      {upgrade}
    </s-banner>
  );
}
