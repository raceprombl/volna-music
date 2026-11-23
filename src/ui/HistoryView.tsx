import { CheckCheck, Disc3, History, Trash2 } from "lucide-react";
import type { Job } from "../types";
import { JobCard } from "./JobCard";
import { Empty, fmt } from "./primitives";

export function HistoryView({
  completed,
  saved,
  retryDisabled,
  onRetry,
  onShow,
  onClear,
}: {
  completed: Job[];
  saved: number;
  retryDisabled: boolean;
  onRetry: (id: string) => void;
  onShow: (id: number) => void;
  onClear: () => void;
}) {
  return (
    <section className="view" aria-labelledby="history-title">
      <div className="page-heading">
        <h1 id="history-title">
          История
          <History size={24} strokeWidth={1.3} />
        </h1>
        <p>
          {saved
            ? `${fmt(saved)} композиций сохранено`
            : "Здесь останутся твои сохранённые треки."}
        </p>
      </div>
      {completed.length === 0 ? (
        <Empty
          icon={Disc3}
          title="Пока нет сохранённых треков"
          text="Скачанная музыка появится здесь. История хранится только в твоём браузере."
        />
      ) : (
        <>
          <div className="history-stats">
            <div>
              <strong>{fmt(saved)}</strong>
              <span>композиций</span>
            </div>
            <div>
              <strong>{completed.length}</strong>
              <span>коллекций</span>
            </div>
            <CheckCheck size={32} strokeWidth={1.2} />
          </div>
          <div className="job-list">
            {[...completed].reverse().map((j) => (
              <JobCard
                key={j.id}
                job={j}
                retryDisabled={retryDisabled}
                onCancel={() => {}}
                onRetry={() => onRetry(j.id)}
                onShow={onShow}
              />
            ))}
          </div>
          <button
            className="text-button danger"
            onClick={() => {
              if (
                confirm(
                  "Очистить историю VOLNA? Скачанные файлы останутся на диске.",
                )
              )
                onClear();
            }}
          >
            <Trash2 size={14} /> Очистить историю
          </button>
        </>
      )}
    </section>
  );
}
