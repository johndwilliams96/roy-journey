import { chromium } from 'playwright';
import fs from 'fs';
import { fileURLToPath } from 'url';
import path from 'path';

const TRAIN_URL = 'https://www.mealtrain.com/trains/8l6y1n';
const __dirname = path.dirname(fileURLToPath(import.meta.url));
const OUTPUT_PATH = path.join(__dirname, '..', 'meals.json');

function norm(s) {
  return (s || '').replace(/\s+/g, ' ').trim().replace(/[\u2018\u2019]/g, "'");
}

async function main() {
  const browser = await chromium.launch();
  const page = await browser.newPage();
  await page.goto(TRAIN_URL, { waitUntil: 'domcontentloaded', timeout: 60000 });
  await page.waitForSelector('.calendar-list-row', { timeout: 45000 });
  await page.waitForTimeout(1500);

  async function dismissModals() {
    await page.evaluate(() => {
      document.querySelectorAll('.modal.show, .modal-backdrop').forEach(el => el.remove());
      document.body.classList.remove('modal-open');
      document.body.style.overflow = '';
    });
  }
  await dismissModals();

  // Reveal further future dates (each click adds ~20 more days)
  for (let i = 0; i < 5; i++) {
    const more = page.getByText(/show \d+ more dates/i);
    const count = await more.count();
    if (count === 0) break;
    await dismissModals();
    await more.first().click({ force: true, timeout: 15000 }).catch(() => {});
    await page.waitForTimeout(1500);
    await dismissModals();
  }

  const todayISO = new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Los_Angeles', year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date());
  const days = await page.evaluate((todayISO) => {
    function norm(s) { return (s || '').replace(/\s+/g, ' ').trim().replace(/[\u2018\u2019]/g, "'"); }
    const MONTHS = { Jan:1,Feb:2,Mar:3,Apr:4,May:5,Jun:6,Jul:7,Aug:8,Sep:9,Oct:10,Nov:11,Dec:12 };
    const nodes = document.querySelectorAll('.calendar-list__divider, .calendar-list-row');
    let currentYear = null;
        const byDate = {};
    nodes.forEach(n => {
      if (n.classList.contains('calendar-list__divider')) {
        const m = n.textContent.trim().match(/(\d{4})/);
        if (m) currentYear = parseInt(m[1], 10);
        return;
      }
      const h3 = n.querySelector('.calendar-list-row__date h3');
      if (!h3 || currentYear == null) return;
      const spans = h3.querySelectorAll('span');
      const monthDay = norm(spans[0] ? spans[0].textContent : '');
      const mm = monthDay.match(/([A-Za-z]{3})\s*(\d{1,2})/);
      if (!mm) return;
      const month = MONTHS[mm[1]];
      const day = parseInt(mm[2], 10);
      if (!month) return;
      const dateObj = new Date(currentYear, month - 1, day);
      const iso = dateObj.getFullYear() + '-' + String(month).padStart(2, '0') + '-' + String(day).padStart(2, '0');
      if (iso < todayISO) return;
      const labelSpan = n.querySelector('.calendar-list__plus-item span');
      const label = norm(labelSpan ? labelSpan.textContent : '');
      let type = null;
      if (/child care/i.test(label)) type = 'childcare';
      else if (/help/i.test(label)) type = 'help';
      else if (/meal/i.test(label)) type = 'meal';
      else return;
      const nameEl = n.querySelector('.calendar-list-row__name');
      const person = norm(nameEl ? nameEl.textContent : '');
      const descEl = n.querySelector('.calendar-list-row__description text-revealer');
      let detail = norm(descEl ? (descEl.getAttribute('text') || descEl.textContent || '') : '');
      if (!byDate[iso]) byDate[iso] = [];
      const item = { type, person };
      if (type === 'meal' && detail) item.detail = detail;
      byDate[iso].push(item);
    });
    return Object.keys(byDate).sort().map(date => ({ date, items: byDate[date] }));
  }, todayISO);

  await browser.close();

  if (!days.length) {
    throw new Error('No meal train days extracted - MealTrain page structure may have changed.');
  }

  let existing = {};
  try {
    existing = JSON.parse(fs.readFileSync(OUTPUT_PATH, 'utf8'));
  } catch (e) {
    // no existing file yet, start fresh with defaults
  }

  const output = {
    organizer: existing.organizer || 'Havilah Williams',
    family: existing.family || '2 Adults, 1 Kid',
    location: existing.location || 'Olympia, WA',
    favorite: existing.favorite || 'Protein and vegetable focused meals',
    leastFavorite: existing.leastFavorite || 'Carb-heavy meals',
    instructions: existing.instructions || 'We eat very small portions. Thank you so much for your help. Bless you!',
    link: TRAIN_URL,
    lastUpdated: new Date().toISOString(),
    days
  };

  fs.writeFileSync(OUTPUT_PATH, JSON.stringify(output, null, 2) + '\n');
  console.log('Wrote ' + days.length + ' days to meals.json');
}

main().catch(err => {
  console.error(err);
  process.exit(1);
});
