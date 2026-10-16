// W-JAX Titel anpassen
// Setzt je Frame die groesste Schriftgroesse der Ebene "title", bei der
//  1. der Text-Block (Titel + Speaker) nicht zu weit nach unten laeuft und
//  2. die Zeilenumbrueche sinnvoll sind (kein Bindestrich-Umbruch, keine Zeile die auf
//     "der/und/of/…" endet, kein Einzelwort als letzte Zeile).
// Arbeitet mit der Auswahl (Frames). Ohne Auswahl: alle Frames der aktuellen Seite.

// ---------- Einstellungen ----------
const MAX_SIZE = 70;                 // groesste erlaubte Schriftgroesse (Vorlage fuer mehrzeilige Titel)
const MAX_SINGLE_LINE_SIZE = 100;    // Obergrenze beim Vergroessern einzeiliger Titel (auf 100px erhoeht)
const MIN_SIZE = 48;                 // kleinste erlaubte Schriftgroesse
const STEP = 2;                      // Schrittweite in px
const LIMIT_BOTTOM = 620;            // Unterkante des Text-Blocks im Frame (y). Promo-Box beginnt bei y=797.
const MARGIN = 6;                    // Sicherheitsabstand in px: Pruefung bei Breite-6, Breite und Breite+6
const ONLY_SHRINK = true;            // true: Schrift wird bei mehrzeiligen Titeln nie groesser gemacht
const DRY_RUN = false;               // true: nichts aendern, nur pruefen und in der Konsole berichten
const TITLE_NAME = 'title';
const SPEAKERS_NAME = 'speakers';
// -----------------------------------

const STOP = new Set(['a','an','the','of','in','on','at','to','for','and','or','with','by','as','is','vs','from','into',
  'der','die','das','den','dem','des','ein','eine','und','oder','mit','für','zu','zum','zur','im','am','auf','von','vom',
  'bei','als','wie','es','ist','nur','aus','nach','um','|','-','–','&']);

function violations(lines) {
  const v = [];
  lines.forEach((ln, i) => {
    if (i < lines.length - 1) {
      if (/\S-$/.test(ln)) v.push('Bindestrich-Umbruch: ' + ln.split(' ').pop());
      const w = ln.split(' ').pop().toLowerCase().replace(/[.,:;!?]+$/, '');
      if (STOP.has(w) && !/[.:;!?]$/.test(ln)) v.push('Zeile endet auf "' + w + '"');
    }
  });
  if (lines.length > 1) {
    const ll = lines[lines.length - 1];
    if (ll.split(' ').length < 2 && ll.length < 16) v.push('Einzelwort am Ende: ' + ll);
  }
  return v;
}

function lineHeightPx(node, size) {
  const lh = node.lineHeight;
  if (lh && lh.unit === 'PERCENT') return size * lh.value / 100;
  if (lh && lh.unit === 'PIXELS') return lh.value;
  return size * 1.2;
}

function relY(node, frame) {
  return node.absoluteTransform[1][2] - frame.absoluteTransform[1][2];
}

async function run() {
  let frames = figma.currentPage.selection.filter(n => n.type === 'FRAME');
  if (!frames.length) frames = figma.currentPage.children.filter(n => n.type === 'FRAME');
  const jobs = [];
  for (const f of frames) {
    const title = f.findOne(n => n.type === 'TEXT' && n.name === TITLE_NAME);
    const spk = f.findOne(n => n.type === 'TEXT' && n.name === SPEAKERS_NAME);
    if (title && spk) jobs.push({ f, title, spk });
  }
  if (!jobs.length) { figma.closePlugin('Keine Frames mit Ebenen "title" und "speakers" gefunden.'); return; }

  // Schriften laden (muss lokal installiert sein)
  for (const j of jobs) {
    if (j.title.hasMissingFont) { figma.closePlugin('Schrift der Ebene "title" fehlt auf diesem Rechner (Avenir LT Std installieren).'); return; }
    const fonts = j.title.getRangeAllFontNames(0, j.title.characters.length);
    for (const fn of fonts) await figma.loadFontAsync(fn);
  }

  const tmp = figma.createText();
  tmp.x = -20000; tmp.y = -20000;
  const report = [];
  try {
    for (const j of jobs) {
      const { f, title, spk } = j;
      const wrap = title.parent;
      const text = title.characters;
      const width = title.width;
      tmp.fontName = title.getRangeFontName(0, 1);
      tmp.lineHeight = title.lineHeight;
      tmp.letterSpacing = title.letterSpacing;
      tmp.textCase = title.textCase;
      tmp.characters = 'x';
      const setW = (w) => { tmp.resize(w, 100); tmp.textAutoResize = 'HEIGHT'; };

      const heightAt = (t, s, w) => { setW(w); tmp.fontSize = s; tmp.characters = t; return tmp.height; };
      const wrapTop = relY(wrap, f);
      const pad = (wrap.paddingTop || 0) + (wrap.paddingBottom || 0);
      const gap = wrap.itemSpacing || 0;
      const bottomAt = (s) => wrapTop + pad + heightAt(text, s, width) + gap + spk.height;

      function linesAt(s, w) {
        const lh = lineHeightPx(title, s);
        setW(w); tmp.fontSize = s;
        let prev = 1; const starts = [0];
        let i = 1;
        while (i <= text.length) {
          tmp.characters = text.slice(0, i);
          const l = Math.max(1, Math.round(tmp.height / lh));
          if (l > prev) {
            // Die Zeile beginnt am Wortanfang (nach Leerzeichen oder Bindestrich), nicht mitten im Wort
            const lineStart = starts[starts.length - 1];
            let j = i - 1;
            while (j > lineStart && text[j - 1] !== ' ' && text[j - 1] !== '-') j--;
            if (j <= lineStart) j = i - 1; // Wort laenger als eine Zeile
            starts.push(j); prev = l;
          }
          i++;
        }
        return starts.map((st, k) => text.slice(st, starts[k + 1] === undefined ? text.length : starts[k + 1]).trim());
      }

      // Pruefung bei Breite-MARGIN, Breite und Breite+MARGIN: nur wenn ueberall kein Verstoss auftritt,
      // ist die Groesse auch bei knappen Grenzfaellen sicher (Messung und echte Darstellung koennen um ~1 px abweichen).
      function evaluate(s) {
        const variants = [width, width - MARGIN, width + MARGIN].map(w => linesAt(s, w));
        const v = [];
        variants.forEach(ls => violations(ls).forEach(x => { if (!v.includes(x)) v.push(x); }));
        const bottom = Math.round(Math.max(bottomAt(s), wrapTop + pad + heightAt(text, s, width - MARGIN) + gap + spk.height));
        return { size: s, lines: variants[0], v, bottom };
      }

      const before = title.fontSize;

      // 1. Prüfen, ob der Titel bei der aktuellen Schriftgröße einzeilig ist
      const isSingleLineNow = linesAt(before, width).length === 1;

      let chosen = null, fallback = null;

      if (isSingleLineNow) {
        // PRIO 1: Versuche auf 2 Zeilen zu vergrößern (von 100px runter bis vor + 2px)
        let s1 = MAX_SINGLE_LINE_SIZE;
        while (s1 > before) {
          const c = evaluate(s1);
          if (c.bottom <= LIMIT_BOTTOM && c.lines.length === 2 && !c.v.length) {
            chosen = c;
            break; // Größte regelkonforme 2-zeilige Variante gefunden!
          }
          s1 -= STEP;
        }

        // PRIO 2: Falls kein 2-Zeiler ohne Regelverstoß klappt, vergrößere als 1-Zeiler (max. 100px)
        if (!chosen) {
          let s2 = MAX_SINGLE_LINE_SIZE;
          while (s2 > before) {
            const c = evaluate(s2);
            if (c.bottom <= LIMIT_BOTTOM && c.lines.length === 1 && !c.v.length) {
              chosen = c;
              break; // Größte regelkonforme 1-zeilige Variante gefunden!
            }
            s2 -= STEP;
          }
        }
      } else {
        // MEHRZEILIGER TITEL: Gewohntes Verhalten (Verkleinern)
        const startSize = ONLY_SHRINK ? Math.min(MAX_SIZE, before) : MAX_SIZE;
        let s = startSize;
        while (s >= MIN_SIZE) {
          const c = evaluate(s);
          if (c.bottom <= LIMIT_BOTTOM) {
            if (!fallback) fallback = c;
            if (!c.v.length) { chosen = c; break; }
          }
          s -= STEP;
        }
      }

      let status = 'ok', res = chosen;
      if (!res) {
        // Falls keine regelkonforme Anpassung möglich war, Original beibehalten
        const orig = evaluate(before);
        res = (orig.bottom <= LIMIT_BOTTOM) ? orig : (fallback || evaluate(MIN_SIZE));
        status = res.bottom > LIMIT_BOTTOM ? 'zu lang' : 'Umbruch pruefen';
      }

      if (!DRY_RUN && res.size !== before) title.fontSize = res.size;
      report.push({ frame: f.name.slice(0, 60), von: before, auf: DRY_RUN ? before : res.size, geprueft: res.size,
        zeilen: res.lines, unterkante: res.bottom, status, hinweise: res.v });
    }
  } finally {
    tmp.remove();
  }
  console.log(JSON.stringify(report, null, 1));
  const warn = report.filter(r => r.status !== 'ok');
  figma.closePlugin(report.length + ' Titel angepasst' + (warn.length ? ', ' + warn.length + ' bitte pruefen (Konsole: Plugins > Entwicklung > Konsole oeffnen)' : ' – alle Umbrueche ok'));
}
run();