async (page) => {
  const results = [];
  const assert = (value, message) => {
    if (!value) throw new Error(message);
    results.push(message);
  };
  await page.context().addInitScript(() => {
    const base = {
      theme: "dark",
      format: "original",
      quality: "best",
      concurrency: 2,
      zip: true,
      numbering: true,
      covers: true,
      metadata: true,
      folder: "VOLNA",
      coverSize: 400,
      logLevel: "off",
      lyricsTags: false,
      lyricsFile: false,
      unicodeFilenames: false,
      structuredFolders: true,
    };
    const tracks = Array.from({ length: 48 }, (_, i) => ({
      id: String(100 + i),
      title: i === 0 ? "Там, где нас нет" : `Композиция ${i + 1}`,
      artists: i === 0 ? "Тестовый исполнитель" : "Исполнитель",
      available: true,
    }));
    const model = { settings: base, jobs: [], tokenPresent: false };
    window.__testModel = model;
    window.__testCalls = [];
    window.chrome = window.chrome || {};
    window.chrome.runtime = {
      id: "volna-ui-test",
      sendMessage: async (m) => {
        window.__testCalls.push(m.type);
        let data;
        if (m.type === "GET_STATE") data = structuredClone(model);
        else if (m.type === "PAGE")
          data = {
            tabId: 1,
            collection: {
              title: "Мой плейлист",
              kind: "playlist",
              tracks,
              url: "https://music.yandex.kz/playlists/test",
              partial: false,
            },
          };
        else if (m.type === "SETTINGS") {
          model.settings = m.settings;
          data = m.settings;
        } else if (m.type === "FORMATS")
          data = [{ codec: "mp3", bitrate: 320 }];
        else if (m.type === "ENQUEUE") {
          model.jobs.push({
            id: "test-job",
            title: m.title,
            status: "queued",
            settings: m.settings,
            created: Date.now(),
            updated: Date.now(),
            items: m.tracks.map((t) => ({
              track: t,
              status: "queued",
              bytes: 0,
              total: 0,
            })),
          });
          data = "test-job";
        } else if (m.type === "CANCEL_JOB") model.jobs[0].status = "cancelled";
        else if (m.type === "RETRY") model.jobs[0].status = "queued";
        else if (m.type === "SET_TOKEN") {
          model.tokenPresent = !!m.token;
          data = { present: model.tokenPresent };
        } else if (m.type === "CLEAR_HISTORY") model.jobs = [];
        else if (m.type === "OPEN_MUSIC") data = true;
        else throw new Error("Unknown test command " + m.type);
        return { ok: true, data };
      },
    };
    const storageListeners = new Set();
    window.__emitStorage = () => storageListeners.forEach(f => f({jobs:{newValue:model.jobs}},"local"));
    window.chrome.storage = {
      onChanged: { addListener: f => storageListeners.add(f), removeListener: f => storageListeners.delete(f) },
    };
  });
  await page.setViewportSize({ width: 440, height: 780 });
  await page.goto("http://127.0.0.1:5174/popup.html");
  await page
    .getByRole("button", { name: "Скачать плейлист", exact: true })
    .waitFor();
  await page.evaluate(() => document.fonts.ready);
  const fonts = await page.evaluate(() => ({
    text: document.fonts.check('14px "YS Text"'),
    headline: document.fonts.check('700 42px "YS Music"'),
    family: getComputedStyle(document.querySelector("h1")).fontFamily,
  }));
  assert(
    fonts.text && fonts.headline && fonts.family.includes("YS Music"),
    "Real Yandex font files loaded",
  );
  await page.screenshot({
    path: "artifacts/home-yandex-dark.png",
    fullPage: true,
  });
  await page
    .getByRole("button", { name: "Скачать плейлист", exact: true })
    .click();
  const dialog = page.getByRole("dialog");
  await dialog.waitFor();
  assert(!(await dialog.textContent()).includes("10 ГБ"), "ZIP caption has no size text");
  assert(
    (await dialog.locator("input[type=checkbox]").count()) === 42,
    "Playlist dialog paginates tracks instead of rendering all at once",
  );
  await dialog.getByRole("button", { name: "Проверить доступность" }).click();
  await page.waitForFunction(() =>
    [...document.querySelectorAll(".format-grid button")].some(
      (b) => b.disabled,
    ),
  );
  assert(
    await dialog
      .getByRole("button", { name: "FLAC", exact: false })
      .isDisabled(),
    "Unavailable FLAC is disabled after API capability check",
  );
  await dialog
    .getByRole("textbox", { name: "Поиск треков" })
    .fill("Там, где нас нет");
  assert(
    (await dialog.locator(".select-track").count()) === 1,
    "Track search filters by title",
  );
  await dialog.getByRole("textbox", { name: "Поиск треков" }).fill("");
  await dialog.screenshot({ path: "artifacts/download-dialog.png" });
  await page.keyboard.press("Escape");
  await dialog.waitFor({ state: "hidden" });
  assert(
    await page
      .getByRole("button", { name: "Скачать плейлист", exact: true })
      .evaluate((e) => e === document.activeElement),
    "Escape dismisses native dialog and restores focus",
  );
  await page
    .getByRole("button", { name: "Скачать плейлист", exact: true })
    .click();
  await page.getByRole("dialog").getByLabel("Потоки загрузки").selectOption("8");
  await page
    .getByRole("dialog")
    .getByRole("button", { name: "Скачать 48 в ZIP" })
    .click();
  await page.getByRole("heading", { name: "Загрузки", exact: false }).waitFor();
  assert(
    (await page.locator(".job-card").count()) === 1,
    "Playlist submit creates a visible queue job",
  );
  assert(await page.evaluate(()=>window.__testModel.jobs[0].settings.concurrency===8), "Eight selected transfer streams reach the queued job");
  await page.getByRole("button", { name: "Отменить Мой плейлист" }).click();
  await page.getByText("Отменено", { exact: true }).waitFor();
  await page.getByRole("button", { name: "Повторить Мой плейлист" }).click();
  await page.getByText("В очереди", { exact: true }).waitFor();
  assert(true, "Cancel and retry actions update durable job state");
  await page.evaluate(()=>{
    const j=window.__testModel.jobs[0];j.status="running";
    j.transfer={receivedBytes:60*1024**2,totalBytes:240*1024**2,estimated:true,bytesPerSecond:2*1024**2,remainingSeconds:90,pendingTracks:36,updatedAt:Date.now()};
    window.__emitStorage();
  });
  await page.locator(".transfer-details").getByText("2 МБ/с",{exact:true}).waitFor();
  assert((await page.locator(".transfer-details").textContent()).includes("Осталось ≈ 1 мин 30 с"),"Queue displays aggregate speed, estimated time and received bytes");
  await page.locator("nav").getByRole("button", { name: "Главная" }).click();
  await page.evaluate(() => {
    const j=window.__testModel.jobs[0]; j.status="running";
    j.items.forEach(i=>Object.assign(i,{status:"fetching",bytes:25,total:100}));
    window.__emitStorage();
  });
  await page.getByRole("button", {name:/Загружается · 25%/}).first().waitFor();
  assert(await page.locator(".collection-card .primary").isDisabled(), "New downloads are disabled while another job runs");
  assert(await page.locator(".collection-card [role=progressbar]").getAttribute("aria-valuenow") === "25", "Circular download indicator displays actual progress");
  await page.screenshot({path:"artifacts/download-busy.png",fullPage:true});
  await page.evaluate(() => {window.__testModel.jobs[0].kind="page";window.__testModel.jobs[0].title="Одна песня";window.__emitStorage();});
  await page.getByRole("button",{name:"Скачать плейлист",exact:true}).waitFor();
  assert(await page.locator(".collection-card .primary").isDisabled() && await page.locator(".collection-card [role=progressbar]").count()===0,"A single-song download does not animate the playlist button");
  await page.evaluate(() => {window.__testModel.jobs[0].status="complete"; window.__emitStorage();});
  await page.getByRole("button",{name:"Скачать плейлист",exact:true}).waitFor();
  assert(await page.getByRole("button",{name:"Скачать плейлист",exact:true}).isEnabled(), "Completion unlocks downloading");
  await page.getByRole("button",{name:"Скачать плейлист",exact:true}).click();
  await page.evaluate(() => {window.__testModel.jobs[0].status="packing";window.__testModel.jobs[0].kind="playlist";window.__testModel.jobs[0].title="Мой плейлист"; window.__emitStorage();});
  await page.getByRole("dialog").getByRole("button",{name:/Загружается ·/}).waitFor();
  assert(await page.getByRole("dialog").getByRole("button",{name:/Загружается ·/}).isDisabled(), "An already open modal locks when another surface starts a download");
  await page.evaluate(() => {window.__testModel.jobs[0].status="cancelled"; window.__emitStorage();});
  await page.keyboard.press("Escape");
  await page.locator("nav").getByRole("button", { name: "Настройки" }).click();
  await page.getByRole("button", { name: "Светлая", exact: true }).click();
  assert(
    (await page.locator("html").getAttribute("data-theme")) === "light",
    "Light theme applies immediately",
  );
  await page.getByLabel("Потоки загрузки").selectOption("5");
  await page.getByLabel("Размер обложки").selectOption("1000");
  await page.getByLabel("Логи расширения").selectOption("debug");
  assert(await page.evaluate(() => window.__testModel.settings.concurrency === 5 && window.__testModel.settings.coverSize === 1000 && window.__testModel.settings.logLevel === "debug"), "Advanced audio settings persist");
  assert(!(await page.getByText(/донат|поддержать разработку/i).count()), "Donation UI is absent");
  await page
    .getByRole("button", { name: "Дополнительный доступ", exact: false })
    .click();
  await page.getByLabel("Личный OAuth-токен").fill("fixture-token");
  await page.getByRole("button", { name: "Подключить", exact: true }).click();
  assert(
    await page.evaluate(() => window.__testModel.tokenPresent),
    "Token form has a working save action",
  );
  await page.screenshot({
    path: "artifacts/settings-light.png",
    fullPage: true,
  });
  await page.emulateMedia({ reducedMotion: "reduce" });
  assert(
    (await page.evaluate(
      () =>
        document.getAnimations().filter((a) => a.playState === "running")
          .length,
    )) === 0,
    "Reduced motion disables running UI animations",
  );
  await page.setViewportSize({ width: 375, height: 760 });
  assert(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth,
    ),
    "375px layout has no horizontal overflow",
  );
  await page.locator("nav").getByRole("button", { name: "Главная" }).click();
  await page.screenshot({
    path: "artifacts/home-light-375.png",
    fullPage: true,
  });
  await page.locator("nav").getByRole("button",{name:"Загрузки"}).click();
  await page.evaluate(()=>{const j=window.__testModel.jobs[0];j.status="failed";j.error="Ошибка соединения с интернетом или сервером. Проверьте сеть и повторите загрузку.";window.__emitStorage();});
  await page.locator(".job-error").getByText(/Проверьте сеть/).waitFor();
  assert(true,"Download failure explains the connection problem and recovery action");
  await page.locator("nav").getByRole("button",{name:"Главная"}).click();
  return { passed: results.length, results };
}
