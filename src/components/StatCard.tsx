import type { LucideIcon } from "lucide-react";

interface Props {
  icon: LucideIcon;
  label: string;
  value: string;
  hint?: string;
}

export function StatCard({ icon: Icon, label, value, hint }: Props) {
  return (
    <div className="relative overflow-hidden rounded-xl border border-border bg-[var(--gradient-card)] p-5 backdrop-blur">
      <div className="absolute -right-6 -top-6 h-20 w-20 rounded-full bg-primary/10 blur-2xl" />
      <div className="relative flex items-start justify-between">
        <div>
          <p className="text-xs font-medium uppercase tracking-wider text-muted-foreground">{label}</p>
          <p className="mt-2 text-2xl font-bold text-foreground">{value}</p>
          {hint && <p className="mt-1 text-xs text-muted-foreground">{hint}</p>}
        </div>
        <div className="flex h-9 w-9 items-center justify-center rounded-lg bg-primary/15 text-primary">
          <Icon className="h-4 w-4" />
        </div>
      </div>
    </div>
  );
}