import { SearchX } from "lucide-react";

export function EmptyState({ title, description }: { title: string; description: string }) {
  return (
    <div className="empty-state" role="status" aria-label={title}>
      <span className="empty-state__icon"><SearchX aria-hidden size={25} /></span>
      <h2>{title}</h2>
      <p>{description}</p>
    </div>
  );
}
