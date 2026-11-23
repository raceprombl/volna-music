import { useState } from "react";
import {
  Check,
  CheckCircle2,
  ChevronRight,
  CircleAlert,
  Clock3,
  FileArchive,
  FolderOpen,
  Loader2,
  Music2,
  RefreshCw,
  X,
} from "lucide-react";
import { progress } from "../shared";
import { activeJobs, type Job } from "../types";
import {
  Cover,
  IconButton,
  Progress,
  statusLabel,
  TransferDetails,
} from "./primitives";

export function JobCard({
  job,
  onCancel,
  onRetry,
  onShow,
  retryDisabled = false,
}: {
  job: Job;
  onCancel: () => void;
  onRetry: () => void;
  onShow: (id: number) => void;
  retryDisabled?: boolean;
}) {
  const [expanded, setExpanded] = useState(false);
  const [visibleItems, setVisibleItems] = useState(40);
  const busy = activeJobs(job),
    done = job.items.filter((i) => i.status === "complete").length,
    failed = job.items.filter((i) => i.status === "failed").length,
    value = progress(job),
    fileId =
      job.downloadId ??
      job.items.find((i) => i.downloadId !== undefined)?.downloadId;
  return (
    <article className={`job-card ${busy ? "is-active" : ""}`}>
      <div className="job-top">
        <Cover track={job.items[0]?.track} />
        <div className="job-name">
          <h3>{job.title}</h3>
          <p>
            {job.settings.zip ? (
              <FileArchive size={12} />
            ) : (
              <Music2 size={12} />
            )}{" "}
            {job.settings.zip ? "ZIP-архив" : "Отдельные файлы"}
            <span>·</span>
            {job.items.length} треков
          </p>
        </div>
        {busy ? (
          <IconButton label={`Отменить ${job.title}`} onClick={onCancel}>
            <X size={17} />
          </IconButton>
        ) : job.status === "complete" ? (
          <CheckCircle2 className="success" size={20} />
        ) : (
          <IconButton
            label={`Повторить ${job.title}`}
            onClick={onRetry}
            disabled={retryDisabled}
          >
            <RefreshCw size={17} />
          </IconButton>
        )}
      </div>
      {busy && <Progress value={value} label={`Прогресс ${job.title}`} />}
      {(busy || job.transfer) && <TransferDetails job={job} />}
      <div className="job-bottom">
        <span
          className={
            job.status === "complete" ? "success" : failed ? "warning" : ""
          }
        >
          {busy && <span className="status-dot online" />}
          {statusLabel[job.status]}
        </span>
        <button
          className="text-button"
          onClick={() => setExpanded(!expanded)}
          aria-expanded={expanded}
        >
          {busy ? `${value}%` : `${done} / ${job.items.length}`}
          <ChevronRight size={13} className={expanded ? "rotate" : ""} />
        </button>
      </div>
      {job.error && <p className="job-error">{job.error}</p>}
      {expanded && (
        <div className="job-items">
          {job.items.slice(0, visibleItems).map((item, i) => (
            <div className="job-item" key={`${item.track.id}-${i}`}>
              <span className="item-number">
                {String(i + 1).padStart(2, "0")}
              </span>
              <div>
                <strong>{item.track.title}</strong>
                <span>{item.error || item.notice || item.track.artists}</span>
              </div>
              {item.status === "complete" ? (
                <Check size={15} className="success" />
              ) : item.status === "failed" ? (
                <CircleAlert size={15} className="warning" />
              ) : ["fetching", "resolving"].includes(item.status) ? (
                <Loader2 className="spin" size={15} />
              ) : (
                <Clock3 size={14} />
              )}
            </div>
          ))}
          {job.items.length > visibleItems && (
            <button
              className="text-button"
              onClick={() => setVisibleItems((count) => count + 40)}
            >
              Показать ещё {Math.min(40, job.items.length - visibleItems)}
            </button>
          )}
        </div>
      )}
      {fileId !== undefined && !busy && (
        <button
          className="text-button show-file"
          onClick={() => onShow(fileId)}
        >
          <FolderOpen size={14} />
          Показать файл
        </button>
      )}
    </article>
  );
}
