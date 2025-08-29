import { chromium } from 'playwright';
import fs from 'fs/promises';

const LOGIN = process.env.ALBATO_LOGIN;
const PASS  = process.env.ALBATO_PASSWORD;

if (!LOGIN || !PASS) {
  console.error('[ERROR] Set ALBATO_LOGIN and ALBATO_PASSWORD secrets!');
  process.exit(1);
}

const LOGIN_URL  = 'https://new.albato.ru/login';
const TARGET_URL = 'https://new.albato.ru/settings/vkads/71/campaigns';

// более надёжные селекторы для кнопки + твой длинный как запасной
const BUTTON_SELECTORS = [
  'button.al-credential-profile__update-button',
  'button:has-text("Обновить")',
  'button:has-text("Update")',
  '#layout > div.al-layout__inner:nth-of-type(1) > div.al-layout__container.al-layout__container_credentials:nth-of-type(3) > div.al-page.al-credentials > div.al-page__container.al-credentials__container > div.al-grid-row.al-grid-row_align_top.al-grid-row_auto-flow_row.al-grid-row_justify_center.al-credentials__container:nth-of-type(1) > div.al-credential-profile:nth-of-type(2) > div.al-credential-profile__container > div.al-flex-box.al-flex-box_align_center.al-flex-box_direction_row.al-flex-box_display_flex.al-flex-box_height_default.al-flex-box_justify_space-between.al-flex-box_width_default.al-flex-box_wrap_nowrap.my-[32px].gap-x-4.lg:gap-x-0:nth-of-type(1) > div.al-flex-box.al-flex-box_align_normal.al-flex-box_direction_row.al-flex-box_display_flex.al-flex-box_height_default.al-flex-box_justify_flex-start.al-flex-box_width_default.al-flex-box_wrap_nowrap:nth-of-type(1) > button.al-button.al-button_color_default.al-button_size_xs.al-button_variant_contained.al-button_weight_600.al-button_width_default.al-credential-profile__update-button.btn.btn-xs.mr-[8px]:nth-of-type(1) > div.al-flex-box.al-flex-box_align_center.al-flex-box_direction_row.al-flex-box_display_flex.al-flex-box_height_available.al-flex-box_justify_center.al-flex-box_width_available.al-flex-box_wrap_nowrap.false.undefined.samelogic-selected'
];

async function doLogin(page) {
  console.log('[INFO] Открываю логин…');
  await page.goto(LOGIN_URL, { waitUntil: 'domcontentloaded', timeout: 60000 });

  // cookie/баннеры — игнорируем, если нет
  await page.getByRole('button', { name: /принять|соглас/i }).first().click({ timeout: 3000 }).catch(()=>{});

  // разные варианты полей логина/пароля
  const emailSel = 'input[name="email"], input[type="email"], input[autocomplete="username"]';
  const passSel  = 'input[name="password"], input[type="password"], input[autocomplete="current-password"]';

  await page.waitForSelector(emailSel, { timeout: 30000 });
  await page.fill(emailSel, LOGIN, { timeout: 15000 });
  await page.fill(passSel,  PASS,  { timeout: 15000 });

  // submit: Enter + ожидание ухода со /login
  await Promise.allSettled([
    page.keyboard.press('Enter'),
    page.waitForURL(url => !String(url).includes('/login'), { timeout: 60000 }),
    page.waitForLoadState('networkidle', { timeout: 60000 })
  ]);
}

async function gotoTarget(page) {
  console.log('[INFO] Перехожу на кампании…');
  await page.goto(TARGET_URL, { waitUntil: 'domcontentloaded', timeout: 60000 });

  // Если нас снова выкинуло на логин — залогинимся и вернёмся.
  if (page.url().includes('/login')) {
    console.log('[WARN] Попали на /login, авторизуюсь повторно…');
    await doLogin(page);
    await page.goto(TARGET_URL, { waitUntil: 'domcontentloaded', timeout: 60000 });
  }
}

async function clickButton(page) {
  console.log('[INFO] Ищу кнопку…');
  // ждём основной контейнер, но не упираемся только в #layout
  await page.waitForLoadState('domcontentloaded');
  await page.waitForTimeout(1500);

  for (const sel of BUTTON_SELECTORS) {
    try {
      const btn = page.locator(sel).first();
      await btn.waitFor({ state: 'visible', timeout: 15000 });
      await btn.scrollIntoViewIfNeeded();
      await btn.click({ timeout: 10000 });
      console.log('[INFO] Кнопка нажата ✅ селектор:', sel);
      return;
    } catch {
      console.log('[INFO] Не подошёл селектор:', sel);
    }
  }
  throw new Error('Кнопка не найдена ни одним селектором');
}

async function runOnce() {
  const artifactsDir = 'artifacts';
  await fs.mkdir(artifactsDir, { recursive: true });

  const browser = await chromium.launch({ headless: true, args: [
    '--disable-blink-features=AutomationControlled'
  ]});
  const ctx = await browser.newContext({
    locale: 'ru-RU',
    viewport: { width: 1440, height: 900 },
    userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/123.0.0.0 Safari/537.36'
  });
  const page = await ctx.newPage();

  try {
    await doLogin(page);
    await gotoTarget(page);
    await clickButton(page);

    console.log('[INFO] Жду 2 минуты…');
    await page.waitForTimeout(120000);

    console.log('[INFO] Обновляю страницу…');
    await page.reload({ waitUntil: 'domcontentloaded' });

    console.log('[INFO] Готово.');
  } catch (e) {
    console.error('[FATAL]', e.stack || e);
    await page.screenshot({ path: `${artifactsDir}/error.png`, fullPage: true }).catch(()=>{});
    await fs.writeFile(`${artifactsDir}/page.html`, await page.content()).catch(()=>{});
    throw e;
  } finally {
    await ctx.close();
    await browser.close();
  }
}

runOnce().catch(() => process.exit(1));
