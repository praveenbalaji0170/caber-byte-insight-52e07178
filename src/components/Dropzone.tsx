import { useCallback, useRef, useState } from "react";
import { UploadCloud, FileText } from "lucide-react";

interface Props {
  onFile: (file: File) => void;
  disabled?: boolean;
}

export function Dropzone({ onFile, disabled }: Props) {
  const [drag, setDrag] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);

  const handle = useCallback(
    (file: File | undefined) => {
      if (!file) return;
      if (file.type !== "application/pdf") {
        alert("Please upload a PDF file.");
        return;
      }
      if (file.size > 50 * 1024 * 1024) {
        alert("File too large (max 50MB).");
        return;
      }
      onFile(file);
    },
    [onFile],
  );

  return (
    <div
      onDragOver={(e) => {
        e.preventDefault();
        setDrag(true);
      }}
      onDragLeave={() => setDrag(false)}
      onDrop={(e) => {
        e.preventDefault();
        setDrag(false);
        handle(e.dataTransfer.files?.[0]);
      }}
      onClick={() => !disabled && inputRef.current?.click()}
      className={`group relative cursor-pointer overflow-hidden rounded-2xl border-2 border-dashed p-12 text-center transition-all ${
        drag
          ? "border-primary bg-primary/5 shadow-[var(--shadow-glow)]"
          : "border-border bg-card/40 hover:border-primary/60 hover:bg-card/60"
      } ${disabled ? "pointer-events-none opacity-50" : ""}`}
    >
      <input
        ref={inputRef}
        type="file"
        accept="application/pdf"
        className="hidden"
        onChange={(e) => handle(e.target.files?.[0] ?? undefined)}
      />
      <div className="flex flex-col items-center gap-4">
        <div className="relative">
          <div className="absolute inset-0 rounded-full bg-primary/30 blur-2xl group-hover:bg-primary/50" />
          <div className="relative flex h-16 w-16 items-center justify-center rounded-full bg-[var(--gradient-primary)] shadow-[var(--shadow-glow)]">
            <UploadCloud className="h-8 w-8 text-primary-foreground" />
          </div>
        </div>
        <div>
          <h3 className="text-lg font-semibold text-foreground">Drop your PDF here</h3>
          <p className="mt-1 text-sm text-muted-foreground">
            or click to browse · max 50MB · up to 20 pages processed
          </p>
        </div>
        <div className="flex items-center gap-2 text-xs text-muted-foreground">
          <FileText className="h-3.5 w-3.5" />
          <span>PDF documents only</span>
        </div>
      </div>
    </div>
  );
}