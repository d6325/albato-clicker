// clicker.js
import { chromium } from 'playwright';
import fs from 'fs/promises';

// --- Конфиг из секретов/переменных окружения ---
const LOGIN = process.env.ALBATO_LOGIN;
const PASS  = process.env.ALBATO_PASSWORD;

// Параметры расписания внутри одного запуска
const LOOPS     = Math.max(1, parseInt(process.env.LOOPS || '6', 10));      // 6 раз = 1 час
const SLEEP_MIN = Math.max(1, parseInt(process.env.SLEEP_MIN || '10', 10)); // пауза между стартами, минут
const SLEEP_MS  = SLEEP_MIN * 60 * 1000;

if (!LOGIN || !PASS) {
  console.error('[ERROR] Установите секреты ALBATO_LOGIN и ALBATO_PASSWORD');
  process.exit(1);
}

// --- URL’ы ---
const LOGIN_URL  = 'https://new.albato.ru/login';
const TARGET_URL = 'https://new.albato.ru/settings/vkads/71/campaigns';

// --- Кандидаты локаторов кнопки (от более надёжных к твоему длинному) ---
const BUTTON_SELECTORS = [
  'button.al-credential-profile__update-button',
  'button:has-text("Обновить")',
  'button:has-text("Update")',
  // запасной: твой длинный селектор
  #layout > div.al-layout__inner > div.al-layout__container.al-layout__container_credentials > div > div > div.al-grid-row.al-grid-row_align_top.al-grid-row_auto-flow_row.al-grid-row_justify_center.al-credentials__container > div.al-credential-profile > div > div.al-flex-box.al-flex-box_align_center.al-flex-box_direction_row.al-flex-box_display_flex.al-flex-box_height_default.al-flex-box_justify_space-between.al-flex-box_width_default.al-flex-box_wrap_nowrap.my-\[32px\].gap-x-4.lg\:gap-x-0 > div.al-flex-box.al-flex-box_align_normal.al-flex-box_direction_row.al-flex-box_display_flex.al-flex-box_height_default.al-flex-box_justify_flex-start.al-flex-box_width_default.al-flex-box_wrap_nowrap > button.al-button.al-button_color_defaultNew.al-button_size_xs.al-button_variant_contained.al-button_weight_600.al-button_width_default.al-credential-profile__update-button.btn.btn-xs.mr-\[8px\] > div
  ];

// ---- Вспомогалка для сна
const sleep = (ms) => new Promise(r => setTimeout(r, ms));

// --- Авторизация ---
async function doLogin(page) {
  console.log('[INFO] Открываю логин…');
  await page.goto(LOGIN_URL, { waitUntil: 'domcontentloaded', timeout: 60_000 });

  // Если нас сразу унесло с /login — уже авторизованы
  if (!page.url().includes('/login')) {
    console.log('[INFO] Уже авторизованы, пропускаю ввод логина/пароля');
    return;
  }

  // Закрыть возможный баннер/куки (если есть)
  await page.getByRole('button', { name: /принять|соглас|accept|ok/i })
    .first().click({ timeout: 3000 }).catch(() => {});

  const emailSel = 'input[name="email"], input[type="email"], input[autocomplete="username"]';
  const passSel  = 'input[name="password"], input[type="password"], input[autocomplete="current-password"]';

  await page.waitForSelector(emailSel, { timeout: 30_000 });
  await page.fill(emailSel, LOGIN, { timeout: 15_000 });
  await page.fill(passSel,  PASS,  { timeout: 15_000 });

  // Отправка формы
  await Promise.allSettled([
    page.keyboard.press('Enter'),
    page.waitForURL(u => !String(u).includes('/login'), { timeout: 60_000 }),
    page.waitForLoadState('networkidle', { timeout: 60_000 })
  ]);
}

// --- Переход на целевую страницу с автоповтором логина при редиректе ---
async function gotoTarget(page) {
  console.log('[INFO] Перехожу на кампании…');
  await page.goto(TARGET_URL, { waitUntil: 'domcontentloaded', timeout: 60_000 });

  if (page.url().includes('/login')) {
    console.log('[WARN] Попали на /login, авторизуюсь повторно…');
    await doLogin(page);
    await page.goto(TARGET_URL, { waitUntil: 'domcontentloaded', timeout: 60_000 });
  }
}

// --- Клик по кнопке ---
async function clickButton(page) {
  console.log('[INFO] Ищу кнопку…');
  await page.waitForLoadState('domcontentloaded');
  await sleep(1500);

  for (const sel of BUTTON_SELECTORS) {
    try {
      const btn = page.locator(sel).first();
      await btn.waitFor({ state: 'visible', timeout: 15_000 });
      await btn.scrollIntoViewIfNeeded();
      await btn.click({ timeout: 10_000 });
      console.log('[INFO] Кнопка нажата ✅ селектор:', sel);
      return;
    } catch {
      console.log('[INFO] Не подошёл селектор:', sel);
    }
  }
  throw new Error('Кнопка не найдена ни одним селектором');
}

// --- Один цикл: логин → переход → клик → 2 минуты → refresh ---
async function runOnce() {
  const artifactsDir = 'artifacts';
  await fs.mkdir(artifactsDir, { recursive: true });

  let browser, ctx, page;
  try {
    console.log('[INFO] Запускаю Chromium…');
    browser = await chromium.launch({
      headless: true,
      channel: 'chromium',
      args: [
        '--no-sandbox',
        '--disable-setuid-sandbox',
        '--disable-dev-shm-usage',
        '--disable-blink-features=AutomationControlled'
      ]
    });

    ctx = await browser.newContext({
      locale: 'ru-RU',
      viewport: { width: 1440, height: 900 },
      userAgent:
        'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/123.0.0.0 Safari/537.36'
    });

    page = await ctx.newPage();

    await doLogin(page);
    await gotoTarget(page);
    await clickButton(page);

    console.log('[INFO] Жду 2 минуты…');
    await sleep(120_000);

    console.log('[INFO] Обновляю страницу…');
    await page.reload({ waitUntil: 'domcontentloaded' });

    console.log('[INFO] Готово.');
  } catch (e) {
    console.error('[FATAL] Ошибка цикла:', e.stack || e);
    if (page) {
      await page.screenshot({ path: `${artifactsDir}/error.png`, fullPage: true }).catch(() => {});
      await fs.writeFile(`${artifactsDir}/page.html`, await page.content()).catch(() => {});
    }
    throw e;
  } finally {
    try { await ctx?.close(); } catch {}
    try { await browser?.close(); } catch {}
  }
}

// --- МНОГОКРАТНЫЙ ЗАПУСК в одном раннере (раз в 10 минут стабильно) ---
(async () => {
  for (let i = 0; i < LOOPS; i++) {
    const started = Date.now();
    console.log(`[INFO] Итерация ${i + 1}/${LOOPS}`);
    await runOnce();

    if (i < LOOPS - 1) {
      // доводим до ровных 10 минут между стартами
      const elapsed = Date.now() - started;
      const rest = SLEEP_MS - elapsed;
      if (rest > 0) {
        console.log(`[INFO] Жду до следующего старта: ~${Math.round(rest / 1000)} сек`);
        await sleep(rest);
      } else {
        console.log('[INFO] Следующий старт без ожидания (прошлая итерация заняла дольше интервала)');
      }
    }
  }
})().catch(() => process.exit(1));
