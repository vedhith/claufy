// Loads the landing page in a real browser and drives the demo, so "interactive"
// is a measured claim rather than an assumption.
const { app, BrowserWindow } = require('electron');
const path = require('path');

app.whenReady().then(async () => {
  const win = new BrowserWindow({ width: 1400, height: 900, show: false });
  const errors = [];
  win.webContents.on('console-message', (_e, level, msg) => { if (level >= 2) errors.push(msg); });
  await win.loadFile(path.join(__dirname, '..', 'site', 'index.html'));
  await new Promise((r) => setTimeout(r, 900));

  const out = await win.webContents.executeJavaScript(`(async () => {
    const g = document.getElementById('grid');
    const settle = () => new Promise(r => setTimeout(r, 500));
    const read = () => ({ cols: g.style.gridTemplateColumns, rows: g.style.gridTemplateRows });
    const res = { tilesAtStart: g.children.length };

    res.growDefault = read();

    // click the last tile -> it should become the hot track
    g.children[g.children.length - 1].click(); await settle();
    res.afterClickLast = read();

    // add two tiles -> grid must reshape
    document.getElementById('add').click(); await settle();
    document.getElementById('add').click(); await settle();
    res.tilesAfterAdd = g.children.length;
    res.shapeAfterAdd = read();

    // solo -> other tracks collapse to 0fr
    document.querySelector('[data-mode=solo]').click(); await settle();
    res.solo = read();
    res.collapsedTiles = [...g.children].filter(t => t.classList.contains('gone')).length;

    // equal -> all tracks identical
    document.querySelector('[data-mode=equal]').click(); await settle();
    res.equal = read();

    // keyboard jump
    document.querySelector('[data-mode=grow]').click(); await settle();
    dispatchEvent(new KeyboardEvent('keydown', { key: '2' })); await settle();
    res.afterKey2 = read();

    // agent view: pointing at a folder must dim every row it cannot see
    const mini = [...document.querySelectorAll('#mini .mini-tile')];
    const allRows = () => [...document.querySelectorAll('#rows .row')];
    res.folders = mini.map(m => m.dataset.p);
    res.rowsTotal = allRows().length;
    res.unscopedVisible = allRows().filter(r => !r.classList.contains('faint')).length;

    const infra = mini.find(m => m.dataset.p === 'infra');
    infra.dispatchEvent(new MouseEvent('mouseenter'));
    await settle();
    res.scopedVisible = allRows().filter(r => !r.classList.contains('faint')).length;
    res.scopedAreInfra = allRows()
      .filter(r => !r.classList.contains('faint'))
      .every(r => r.dataset.p === 'infra');
    res.scopeFoot = document.getElementById('scope-foot').textContent.trim();

    // leaving without pinning must restore the full list
    document.getElementById('mini').dispatchEvent(new MouseEvent('mouseleave'));
    await settle();
    res.restoredVisible = allRows().filter(r => !r.classList.contains('faint')).length;

    res.markRendered = !!document.querySelector('#mark-hero svg rect');
    res.faviconSet = !!document.querySelector('link[rel=icon]');
    res.osButton = document.getElementById('get').textContent;
    return res;
  })()`);

  console.log('RESULT ' + JSON.stringify(out));
  if (errors.length) console.log('CONSOLE_ERRORS ' + JSON.stringify(errors.slice(0, 5)));
  app.exit(0);
});
