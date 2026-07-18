interface StatusMessageProps {
  title: string;
  message: string;
  actionLabel?: string;
  onAction?: () => void;
  role?: "alert" | "status";
}

export function StatusMessage({ title, message, actionLabel, onAction, role = "status" }: StatusMessageProps) {
  return (
    <section className="status-message" role={role}>
      <span className="status-message__mark" aria-hidden="true">!</span>
      <div>
        <h2>{title}</h2>
        <p>{message}</p>
        {actionLabel && onAction ? (
          <button className="button button--secondary" type="button" onClick={onAction}>
            {actionLabel}
          </button>
        ) : null}
      </div>
    </section>
  );
}
