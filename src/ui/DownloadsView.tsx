import { ArrowDownToLine, ChevronRight, LockKeyhole } from "lucide-react";
import type { Job } from "../types";
import { JobCard } from "./JobCard";
import { Empty, type Tab } from "./primitives";

export function DownloadsView({
  jobs,
  activeCount,
  onNavigate,
  onCancel,
  onRetry,
  onShow,
}: {
  jobs: Job[];
  activeCount: number;
  onNavigate: (tab: Tab) => void;
  onCancel: (id: string) => void;
  onRetry: (id: string) => void;
  onShow: (id: number) => void;
}) {
  return (
    <section className="view" aria-labelledby="downloads-title">
      <div className="page-heading">
        <h1 id="downloads-title">
          Загрузки<span className="heading-count">{activeCount}</span>
        </h1>
        <p>Продолжатся, даже если закрыть окно.</p>
      </div>
      {jobs.length === 0 ? (
        <Empty
          icon={ArrowDownToLine}
          title="Очередь пока пуста"
          text="Добавь первый трек или целый плейлист. Здесь будет виден каждый шаг."
          action={
            <button
              className="button subtle"
              onClick={() => onNavigate("home")}
            >
              К моей музыке
              <ChevronRight size={15} />
            </button>
          }
        />
      ) : (
        <div className="job-list">
          {[...jobs].reverse().map((j) => (
            <JobCard
              key={j.id}
              job={j}
              retryDisabled={activeCount > 0}
              onCancel={() => onCancel(j.id)}
              onRetry={() => onRetry(j.id)}
              onShow={onShow}
            />
          ))}
        </div>
      )}
      <div className="quiet-note">
        <LockKeyhole size={14} /> Никаких внешних серверов VOLNA
      </div>
    </section>
  );
}
