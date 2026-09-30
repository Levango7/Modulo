import puppeteer from 'puppeteer-core';
import fs from 'node:fs';
const EXE = 'C:/Program Files/Google/Chrome/Application/chrome.exe';
const URL = 'http://localhost:1430/';
const OUT = 'F:/Nexus/Modulo/evidence';
fs.mkdirSync(OUT, { recursive: true });

const b = await puppeteer.launch({ executablePath: EXE, headless: 'new', args: ['--no-sandbox', '--disable-gpu'] });
const p = await b.newPage();
const errs = [];
p.on('pageerror', (e) => errs.push(String(e.message).slice(0, 200)));
const out = { workbench: [], editor: [] };

const measure = () =>
  p.evaluate(() => {
    const cells = [...document.querySelectorAll('.cell')];
    const boxes = cells.map((c) => {
      const r = c.getBoundingClientRect();
      return { id: c.querySelector('.card-head span, .time, .name')?.textContent?.trim().slice(0, 6) ?? '?', w: Math.round(r.width), h: Math.round(r.height) };
    });
    const fonts = [...document.querySelectorAll('.cell *')]
      .filter((e) => e.children.length === 0 && (e.textContent || '').trim())
      .map((e) => parseFloat(getComputedStyle(e).fontSize));
    return {
      innerWidth: window.innerWidth,
      hScroll: document.documentElement.scrollWidth > window.innerWidth + 1,
      cols: document.querySelector('.grid') ? getComputedStyle(document.querySelector('.grid')).gridTemplateColumns.split(' ').length : 0,
      cellCount: cells.length,
      boxes,
      minFontPx: fonts.length ? Math.round(Math.min(...fonts) * 10) / 10 : null,
      clipped: [...document.querySelectorAll('.cell *')].filter(
        (e) => e.children.length === 0 && (e.textContent || '').trim() && e.scrollWidth - e.clientWidth > 2,
      ).length,
      metric: document.querySelector('.metric')?.textContent?.trim() ?? null,
      collapsed: document.querySelector('.collapsed')?.textContent?.trim() ?? null,
    };
  });

for (const vp of [
  { name: '1440', w: 1440, h: 900 },
  { name: '720', w: 720, h: 900 },
  { name: '390', w: 390, h: 844 },
]) {
  await p.setViewport({ width: vp.w, height: vp.h, deviceScaleFactor: 2 });
  await p.goto(URL, { waitUntil: 'networkidle2', timeout: 60000 });
  await new Promise((r) => setTimeout(r, 700));
  const m = await measure();
  await p.screenshot({ path: `${OUT}/modulo-${vp.name}.png` });
  out.workbench.push({ vp: vp.name, ...m });
  console.log(`[工作台 ${vp.name}] cols=${m.cols} hScroll=${m.hScroll} cells=${m.cellCount} minFont=${m.minFontPx}px clipped=${m.clipped} metric="${m.metric}" collapsed=${m.collapsed ? 'yes' : 'no'}`);
  console.log('   卡片宽:', JSON.stringify(m.boxes.map((x) => `${x.id}:${x.w}x${x.h}`)));
}

// 编辑器：三档视口下的模式与键盘可达性
for (const vp of [
  { name: '1440', w: 1440, h: 900 },
  { name: '720', w: 720, h: 900 },
  { name: '390', w: 390, h: 844 },
]) {
  await p.setViewport({ width: vp.w, height: vp.h, deviceScaleFactor: 2 });
  await p.goto(URL, { waitUntil: 'networkidle2', timeout: 60000 });
  await new Promise((r) => setTimeout(r, 500));
  await p.evaluate(() => {
    const btn = [...document.querySelectorAll('button')].find((e) => (e.textContent || '').trim() === '布局编辑');
    btn?.click();
  });
  await new Promise((r) => setTimeout(r, 700));
  const em = await p.evaluate(() => ({
    canvas: !!document.querySelector('.canvas'),
    stack: !!document.querySelector('.stack'),
    focusableCells: document.querySelectorAll('.cell[tabindex="0"]').length,
    libItems: document.querySelectorAll('.lib-item').length,
    metric: document.querySelector('.metric')?.textContent?.trim() ?? null,
    badges: [...document.querySelectorAll('.badge')].map((x) => x.textContent.trim()).slice(0, 5),
  }));
  await p.screenshot({ path: `${OUT}/editor-${vp.name}.png` });
  out.editor.push({ vp: vp.name, ...em });
  console.log(`[编辑器 ${vp.name}] canvas=${em.canvas} stack=${em.stack} 可聚焦格=${em.focusableCells} 库项=${em.libItems} metric="${em.metric}"`);
}

out.errors = errs;
fs.writeFileSync(`${OUT}/report.json`, JSON.stringify(out, null, 2));
console.log('errors:', JSON.stringify(errs.slice(0, 3)));
await b.close();
