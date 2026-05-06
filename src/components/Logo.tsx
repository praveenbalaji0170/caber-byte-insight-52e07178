import { Cpu } from "lucide-react";

export function Logo({ className = "" }: { className?: string }) {
  return (
    <div className={`flex items-center gap-2 ${className}`}>
      <div className="relative flex h-9 w-9 items-center justify-center rounded-lg bg-[var(--gradient-primary)] shadow-[var(--shadow-glow)]">
        <Cpu className="h-5 w-5 text-primary-foreground" strokeWidth={2.5} />
      </div>
      <div className="leading-none">
        <div className="text-sm font-bold tracking-[0.2em] text-foreground">CABER BYTE</div>
        <div className="text-[10px] tracking-widest text-muted-foreground">DOCUMENT INTELLIGENCE</div>
      </div>
    </div>
  );
}