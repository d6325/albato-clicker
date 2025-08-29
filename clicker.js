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

const CANDIDATE_SELECTORS = [
  'button.al-credential-profile__update-button',
  'button:has-text("Обновить")',
  'button:has-text("Update")',
  '#layout > div.al-layout__inner:nth-of-type(1) > div.al-layout__container.al-layout__container_credentials:nth-of-type(3) > div.al-page.al-credentials > div.al-page__container.al-credentials__container > div.al-grid-row.al-grid-row_align_top.al-grid-row_auto-flow_row.al-grid-row_justify_center.al-credentials__container:nth-of-type(1) > div.al-credential-profile:nth-of-type(2) > div.al-credential-profile__container > div.al-flex-box.al-flex-box_align_center.al-flex-box_direction_row.al-flex-box_display_flex.al-flex-box_height_default.al-flex-box_justify_space-between.al-flex-box_width_default.al-flex-box_wrap_nowrap.my-[32px].gap-x-4.lg:gap-x-0:nth-of-type(1) > div.al-flex-box.al-flex-box_align_normal.al-flex-box_direction_row.al-flex-box_display_flex.al-flex-box_height_default.al-flex-box_justify_flex-start.al-flex-box_width_default.al-flex-box_wrap_nowrap:nth-of-type(1) > button.al-button.al-button_color_default.al-button_size_xs.al-button_variant_contained.al-button_weight_600.al-button_width_default.al-credential-profile__update-button.btn.btn-xs.mr-[8px]:nth-of-type(1) > div.al-flex-box.al-flex-box_align_center.al-flex-box_direction_row.al-flex-box_display_flex.al-flex-box_height_available.al-flex-box_justify_center.al-flex-box_width_available.al-flex-box_wrap_nowrap.false.undefined.samelogic-selected'
];

async function runOnce() {
  const artifactsDir = 'artifacts';
  await fs.mkdir(artifactsDir, { recursive: true });

  const browser = await chromium.launch({ headless: true });
  const ctx = await browser.newContext({
    locale: 'ru-RU',
    viewport: { width: 1440, height: 900 }
  });
  const page = await ctx.newPage();
  const log = (...a) => console.log('[INFO]', ...a);

  try {
    // 1) Логин
    log('Открываю логин...');
    await page.goto(LOGIN_URL, { waitUntil: 'domcontentloaded', timeout: 60000 });

    const needLogin = await page.locator('input[name="email"]').count();
    if (needLogin) {
      log('Ввожу логин/пароль...');
      await page.fill('input[name="email"]', LOGIN);
      await page.fill('input[name="password"]', PASS);
      await Promise.all([
        page.keyboard.press('Enter'),
        page.waitForLoadState('networkidle').catch(() => {})
      ]);
    }

    // 2) Целевая страница
    log('Открываю кампании...');
    await page.goto(TARGET_URL, { waitUntil: 'domcontentloaded', timeout: 60000 });
    await page.waitForSelector('#layout', { timeout: 60000 });

    // 3) Клик
    log('Ищу кнопку и кликаю...');
    let clicked = false;
    for (const sel of CANDIDATE_SELECTORS) {
      try {
        const btn = page.locator(sel).first();
        await btn.waitFor({ state: 'visible', timeout: 15000 });
        await btn.scrollIntoViewIfNeeded();
        await btn.click({ timeout: 10000 });
        clicked = true;
        log('Кнопка нажата ✅ селектор:', sel);
        break;
      } catch {
        log('Не подошёл селектор:', sel);
      }
    }
    if (!clicked) throw new Error('Кнопка не найдена/не кликается');

    // 4) Ждём 2 минуты
    log('Жду 2 минуты...');
    await page.waitForTimeout(120000);

    // 5) Обновляем страницу
    log('Обновляю страницу...');
    await page.reload({ waitUntil: 'domcontentloaded' });
    await page.waitForSelector('#layout', { timeout: 30000 });

    log('Готово.');
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
