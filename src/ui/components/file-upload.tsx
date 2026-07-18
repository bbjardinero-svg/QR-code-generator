import { useRef, useState, type DragEvent } from "react";
import { MAX_FILE_BYTES } from "../../shared/constants";

const ALLOWED_FILES = new Map<string, ReadonlySet<string>>([
  [".pdf", new Set(["application/pdf"])],
  [".docx", new Set(["application/vnd.openxmlformats-officedocument.wordprocessingml.document"])],
  [".pptx", new Set(["application/vnd.openxmlformats-officedocument.presentationml.presentation"])],
  [".xlsx", new Set(["application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"])],
  [".csv", new Set(["text/csv", "text/plain"])],
  [".txt", new Set(["text/plain"])],
  [".png", new Set(["image/png"])],
  [".jpg", new Set(["image/jpeg"])],
  [".jpeg", new Set(["image/jpeg"])],
  [".webp", new Set(["image/webp"])],
  [".mp3", new Set(["audio/mpeg"])],
  [".mp4", new Set(["video/mp4"])],
  [".zip", new Set(["application/zip", "application/x-zip-compressed"])],
]);

const ACCEPT = [...ALLOWED_FILES.keys()].join(",");

interface FileUploadProps {
  file: File | null;
  onFile: (file: File | null) => void;
  inputLabel?: string;
  progress?: number | null;
  disabled?: boolean;
}

function formatBytes(bytes: number): string {
  if (bytes < 1_000_000) return `${Math.max(1, Math.round(bytes / 1_000))} KB`;
  return `${(bytes / 1_000_000).toFixed(1).replace(/\.0$/, "")} MB`;
}

function fileError(file: File): string | null {
  if (file.size > MAX_FILE_BYTES) return "Choose a file that is 100 MB or smaller.";
  const dot = file.name.lastIndexOf(".");
  const extension = dot >= 0 ? file.name.slice(dot).toLowerCase() : "";
  if (!ALLOWED_FILES.get(extension)?.has(file.type.toLowerCase())) return "This file type is not allowed.";
  return null;
}

export function FileUpload({ file, onFile, inputLabel = "Choose file", progress = null, disabled = false }: FileUploadProps) {
  const [error, setError] = useState<string | null>(null);
  const [dragging, setDragging] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);

  function select(next: File | undefined) {
    if (!next) return;
    const nextError = fileError(next);
    setError(nextError);
    onFile(nextError ? null : next);
    if (nextError && inputRef.current) inputRef.current.value = "";
  }

  function drop(event: DragEvent<HTMLDivElement>) {
    event.preventDefault();
    setDragging(false);
    if (!disabled) select(event.dataTransfer.files[0]);
  }

  return (
    <div className="file-upload">
      <div
        className={`drop-zone${dragging ? " is-dragging" : ""}${file ? " has-file" : ""}`}
        aria-label="Drop file here"
        onDragEnter={(event) => { event.preventDefault(); setDragging(true); }}
        onDragOver={(event) => event.preventDefault()}
        onDragLeave={() => setDragging(false)}
        onDrop={drop}
      >
        <span className="drop-zone__glyph" aria-hidden="true">↑</span>
        {file ? (
          <div>
            <strong>{file.name}</strong>
            <span>{formatBytes(file.size)} · Ready to upload</span>
          </div>
        ) : (
          <div>
            <strong>Drop one file here</strong>
            <span>PDF, Office, image, text, audio, video, or ZIP · up to 100 MB</span>
          </div>
        )}
        <label className="button button--secondary">
          {file ? "Choose another" : inputLabel}
          <input
            ref={inputRef}
            className="visually-hidden"
            type="file"
            accept={ACCEPT}
            aria-label={inputLabel}
            disabled={disabled}
            onChange={(event) => select(event.target.files?.[0])}
          />
        </label>
      </div>
      {error ? <p className="form-error" role="alert">{error}</p> : null}
      {progress != null ? (
        <div className="upload-progress">
          <div role="progressbar" aria-label="File upload" aria-valuemin={0} aria-valuemax={100} aria-valuenow={progress}>
            <i style={{ width: `${progress}%` }} />
          </div>
          <span>{progress < 100 ? `Uploading ${progress}%` : "Upload verified"}</span>
        </div>
      ) : null}
    </div>
  );
}
