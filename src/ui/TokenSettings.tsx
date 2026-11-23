import { useState } from "react";
import {
  ArrowUpRight,
  ChevronRight,
  Loader2,
  LockKeyhole,
  ShieldCheck,
} from "lucide-react";
import { friendly, rpc } from "../shared";
import { installed } from "./bridge";

export function TokenSettings({
  present,
  onChange,
  notify,
}: {
  present: boolean;
  onChange: () => void;
  notify: (t: string) => void;
}) {
  const [value, setValue] = useState(""),
    [saving, setSaving] = useState(false),
    [expanded, setExpanded] = useState(false);
  async function save(token: string) {
    setSaving(true);
    try {
      await rpc("SET_TOKEN", { token });
      setValue("");
      onChange();
      notify(token ? "Аккаунт подключён до закрытия браузера" : "Токен удалён");
    } catch (e) {
      notify(friendly(e));
    } finally {
      setSaving(false);
    }
  }
  return (
    <div className="settings-section">
      {!present && (
        <div className="token-form">
          <button
            className="button subtle wide"
            disabled={saving || !installed}
            onClick={async () => {
              setSaving(true);
              try {
                const result = await rpc("CONNECT_ACCOUNT");
                onChange();
                notify(
                  result.connected
                    ? "Доступ Яндекс Музыки подключён"
                    : "Заверши вход на открытой странице Яндекса. Доступ подключится автоматически",
                );
              } catch (e) {
                notify(friendly(e));
              } finally {
                setSaving(false);
              }
            }}
          >
            <LockKeyhole size={16} />
            <span>Подключить Яндекс Музыку</span>
            <ArrowUpRight size={15} />
          </button>
          <p>
            Используем текущий вход. Если Яндекс запросит разрешение, подтверди
            его на странице Яндекса. Копировать OAuth вручную не нужно.
          </p>
        </div>
      )}
      <button
        className="section-disclosure"
        onClick={() => setExpanded(!expanded)}
        aria-expanded={expanded}
      >
        <span>
          <LockKeyhole size={16} />
          Дополнительный доступ
        </span>
        <span className={present ? "success" : "muted"}>
          {present ? "Подключён" : "Необязательно"}
          <ChevronRight size={15} className={expanded ? "rotate" : ""} />
        </span>
      </button>
      {expanded && (
        <div className="token-form">
          <p>
            Сначала используем вход в открытой Яндекс Музыке. Ручной токен нужен
            только если встроенного входа недостаточно. Пароль не нужен. Токен
            передаётся только API Яндекса и хранится до закрытия браузера.
          </p>
          <label className="input-setting">
            <span>Личный OAuth-токен</span>
            <input
              type="password"
              autoComplete="off"
              spellCheck={false}
              value={value}
              onChange={(e) => setValue(e.target.value)}
              placeholder="Вставить токен"
            />
          </label>
          <div className="button-row">
            <button
              className="button primary"
              disabled={saving || !value.trim() || !installed}
              onClick={() => void save(value)}
            >
              {saving ? (
                <Loader2 className="spin" size={15} />
              ) : (
                <ShieldCheck size={15} />
              )}
              Подключить
            </button>
            {present && (
              <button
                className="button subtle"
                disabled={saving}
                onClick={() => void save("")}
              >
                Отключить
              </button>
            )}
          </div>
          <p className="fine-print">
            Если на сайте уже сохранён Music OAuth-токен (aYa_token), VOLNA
            проверяет только его. Остальное хранилище сайта, cookies и пароли не
            читаются.
          </p>
        </div>
      )}
    </div>
  );
}
