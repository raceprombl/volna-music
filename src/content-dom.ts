export const NS = "data-volna";

export const paths = {
  download: "M12 3v12m-4-4 4 4 4-4M5 16v4h14v-4",
  close: "m6 6 12 12M6 18 18 6",
  wave: "M3 10v4m4-8v12m5-15v18m5-15v12m4-8v4",
  check: "m5 12 4 4L19 6",
  arrow: "M7 17 17 7M7 7h10v10",
  document: "M14 2H6v20h12V6zM14 2v5h5M9 12h6M9 16h6",
  settings: "M4 7h16M4 17h16M8 4v6m8 4v6",
};

export function icon(name: keyof typeof paths) {
  const svg = document.createElementNS("http://www.w3.org/2000/svg", "svg");
  svg.setAttribute("viewBox", "0 0 24 24");
  svg.setAttribute("width", "20");
  svg.setAttribute("height", "20");
  svg.setAttribute("fill", "none");
  svg.setAttribute("stroke", "currentColor");
  svg.setAttribute("stroke-width", "1.8");
  svg.setAttribute("stroke-linecap", "round");
  svg.setAttribute("stroke-linejoin", "round");
  svg.setAttribute("aria-hidden", "true");
  const p = document.createElementNS(svg.namespaceURI, "path");
  p.setAttribute("d", paths[name]);
  svg.append(p);
  return svg;
}

const css = `:host{all:initial;font:14px/1.5 'YS Text','Yandex Sans Text','Segoe UI',Arial,sans-serif;color:#f5f4f0;color-scheme:dark}*{box-sizing:border-box}button,input,select{font:inherit}button{cursor:pointer;border:0}button:disabled{opacity:.5;cursor:wait}button:focus-visible,select:focus-visible,input:focus-visible{outline:2px solid #ffdc5e;outline-offset:4px}button{min-height:44px;border-radius:12px;background:#303033;color:#f5f4f0;padding:10px 16px;display:inline-flex;gap:10px;align-items:center;justify-content:center}.primary{background:#ffdc5e;color:#1a180e;font-weight:650}.icon{width:36px;min-height:36px;padding:8px;border-radius:50%;background:transparent;color:inherit}.toolbar{display:flex;gap:10px;align-items:center}.brand{color:#ffdc5e}dialog{color:#f5f4f0;background:#18191b;border:1px solid #363638;border-radius:24px;padding:28px;width:min(480px,calc(100vw - 32px));max-height:86vh;overflow:auto;overscroll-behavior:contain;box-shadow:0 32px 120px #0008;opacity:0;transition:opacity 150ms,display 150ms,overlay 150ms;transition-behavior:allow-discrete}dialog[open]{opacity:1}dialog::backdrop{background:#0009;overscroll-behavior:contain;overflow:hidden;backdrop-filter:blur(4px)}h2{font-size:26px;line-height:1.2;letter-spacing:-.8px;margin:16px 0 8px}.muted{color:#aaa9ae;font-size:13px}.head{display:flex;justify-content:flex-end;align-items:center}.field{display:grid;gap:8px;margin-top:16px}.field select{width:100%;background:#252629;border:1px solid #3a3a3d;color:inherit;padding:12px;border-radius:12px}.check{display:flex;align-items:center;gap:10px;margin:16px 0}.check input{accent-color:#ffdc5e;width:18px;height:18px}.actions{display:flex;gap:10px;margin-top:24px}.actions .primary{flex:1}.notice{background:#ffdc5e0a;border:1px solid #ffdc5e29;border-radius:12px;padding:12px;margin:18px 0;color:#d7d2bc;font-size:12px}.progress{height:5px;background:#333438;border-radius:5px;overflow:hidden;margin:18px 0}.bar{height:100%;background:#ffdc5e;transform-origin:left;transform:scaleX(0)}.error{color:#ff9993;white-space:pre-wrap}.toast{position:fixed;right:24px;bottom:100px;max-width:380px;padding:14px 20px;border-radius:14px;border:1px solid #555;background:#202124;color:#fff;box-shadow:0 8px 40px #0006}.trackbutton{color:#c1bdad}.trackbutton:hover{color:#ffdc5e}@media(prefers-reduced-motion:no-preference){button{transition:transform 120ms cubic-bezier(.2,0,0,1),opacity 120ms}button:hover{transform:translateY(-1px)}button:active{transform:scale(.97)}.bar{transition:transform 260ms cubic-bezier(.2,0,0,1)}dialog{transform:translateY(10px) scale(.98);transition:opacity 150ms,transform 150ms,display 150ms,overlay 150ms;transition-behavior:allow-discrete}dialog[open]{transform:none;transition-duration:240ms}@starting-style{dialog[open]{opacity:0;transform:translateY(10px) scale(.98)}}}`;

export function shadowHost() {
  const host = document.createElement("span");
  host.setAttribute(NS, "");
  const shadow = host.attachShadow({ mode: "open" });
  const style = document.createElement("style");
  style.textContent =
    css +
    `.transfer-details{margin:12px 0;font-size:12px;color:#aaa9ae;font-variant-numeric:tabular-nums}.transfer-details>div{display:flex;justify-content:space-between;gap:8px 16px;flex-wrap:wrap}.transfer-details>div>span:first-child{color:#f5f4f0}.transfer-details p{margin:4px 0}.transfer-details [hidden]{display:none}`;
  shadow.append(style);
  return { host, shadow };
}

export function circleProgress(value: number) {
  const svg = document.createElementNS("http://www.w3.org/2000/svg", "svg");
  svg.setAttribute("viewBox", "0 0 24 24");
  svg.setAttribute("width", "22");
  svg.setAttribute("height", "22");
  svg.setAttribute("fill", "none");
  svg.setAttribute("stroke", "currentColor");
  svg.setAttribute("stroke-width", "2.2");
  svg.style.transform = "rotate(-90deg)";
  svg.setAttribute("role", "progressbar");
  svg.setAttribute("aria-label", "Прогресс загрузки");
  svg.setAttribute("aria-valuemin", "0");
  svg.setAttribute("aria-valuemax", "100");
  svg.setAttribute("aria-valuenow", String(value));
  for (const filled of [false, true]) {
    const circle = document.createElementNS(svg.namespaceURI, "circle");
    for (const [key, val] of Object.entries({ cx: "12", cy: "12", r: "9" }))
      circle.setAttribute(key, val);
    if (filled) {
      circle.setAttribute("pathLength", "100");
      circle.setAttribute("stroke-dasharray", "100");
      circle.setAttribute("stroke-dashoffset", String(100 - value));
      circle.setAttribute("stroke-linecap", "round");
    } else circle.setAttribute("opacity", ".2");
    svg.append(circle);
  }
  return svg;
}

export function element<K extends keyof HTMLElementTagNameMap>(
  tag: K,
  text?: string,
  className?: string,
) {
  const e = document.createElement(tag);
  if (text) e.textContent = text;
  if (className) e.className = className;
  return e;
}
