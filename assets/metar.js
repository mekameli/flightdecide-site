/* METAR decoder for /tools/metar-decoder/ (2026-09-26). Pure JavaScript, no
 * network: the report a pilot pastes is read in the browser and nowhere else.
 *
 *   FDMetar.decode(text)  ->  { ok, station, time, wind, visibility, weather,
 *                               clouds, ceiling, temp, dew, altimeter,
 *                               remarks, category, groups, unknown, ... }
 *
 * `groups` is the report group by group, in order ({raw, label, text}), which
 * is what the page shows. Flight category follows the FAA definitions the
 * Aviation Weather Center charts use: LIFR below 500 ft or 1 SM, IFR below
 * 1,000 ft or 3 SM, MVFR 1,000 to 3,000 ft or 3 to 5 SM, VFR above both.
 * The ceiling is the lowest broken or overcast layer or vertical visibility.
 *
 * Tested by scripts/tests/js/test_metar_decoder.mjs (US, Canadian and ICAO
 * reports, including VRB, calm, M temperatures, 1 1/2SM, VV, AUTO, COR, RMK).
 */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.FDMetar = factory();
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  var PRECIP = { DZ: 'drizzle', RA: 'rain', SN: 'snow', SG: 'snow grains', IC: 'ice crystals',
    PL: 'ice pellets', GR: 'hail', GS: 'small hail or snow pellets', UP: 'unknown precipitation' };
  var OBSC = { BR: 'mist', FG: 'fog', FU: 'smoke', VA: 'volcanic ash', DU: 'widespread dust',
    SA: 'sand', HZ: 'haze', PY: 'spray' };
  var OTHER = { PO: 'dust or sand whirls', SQ: 'squalls', FC: 'funnel cloud', SS: 'sandstorm',
    DS: 'duststorm' };
  var DESC = { MI: 'shallow', PR: 'partial', BC: 'patches of', DR: 'low drifting', BL: 'blowing',
    SH: 'showers', TS: 'thunderstorm', FZ: 'freezing' };
  var COVER = { FEW: 'Few clouds', SCT: 'Scattered clouds', BKN: 'Broken clouds', OVC: 'Overcast' };
  var OKTAS = { FEW: '1 to 2 eighths of the sky', SCT: '3 to 4 eighths', BKN: '5 to 7 eighths',
    OVC: 'the whole sky' };
  var CLOUD_TYPES = { CI: 'cirrus', CC: 'cirrocumulus', CS: 'cirrostratus', AC: 'altocumulus',
    ACC: 'altocumulus castellanus', AS: 'altostratus', NS: 'nimbostratus', SC: 'stratocumulus',
    ST: 'stratus', SF: 'stratus fractus', CF: 'cumulus fractus', CU: 'cumulus',
    TCU: 'towering cumulus', CB: 'cumulonimbus', FG: 'fog', BR: 'mist', HZ: 'haze', FU: 'smoke',
    SN: 'snow', RA: 'rain', DZ: 'drizzle', SA: 'sand', DU: 'dust' };
  var WX_CODES = 'DZ|RA|SN|SG|IC|PL|GR|GS|UP|BR|FG|FU|VA|DU|SA|HZ|PY|PO|SQ|FC|SS|DS';
  var WX_RE = new RegExp('^(-|\\+|VC)?((?:MI|PR|BC|DR|BL|SH|TS|FZ)*)((?:' + WX_CODES + ')*)$');
  var COMPASS = { N: 'north', NE: 'northeast', E: 'east', SE: 'southeast', S: 'south',
    SW: 'southwest', W: 'west', NW: 'northwest' };
  var REGIONS = [['K', 'the United States'], ['C', 'Canada'], ['PA', 'Alaska'], ['PH', 'Hawaii'],
    ['PG', 'Guam'], ['TJ', 'Puerto Rico'], ['MM', 'Mexico'], ['EG', 'the United Kingdom'],
    ['EI', 'Ireland'], ['LF', 'France'], ['ED', 'Germany'], ['Y', 'Australia'], ['NZ', 'New Zealand']];

  function fmtInt(n) { return Math.round(n).toLocaleString('en-US'); }
  function pad(n, w) { return String(n).padStart(w || 2, '0'); }
  function ordinal(d) {
    var s = ['th', 'st', 'nd', 'rd'], v = d % 100;
    return d + (s[(v - 20) % 10] || s[v] || s[0]);
  }
  function tempOf(s) {
    if (!s || /\//.test(s)) return null;
    return s.charAt(0) === 'M' ? -parseInt(s.slice(1), 10) : parseInt(s, 10);
  }
  function tenths(sign, digits) { return (sign === '1' ? -1 : 1) * parseInt(digits, 10) / 10; }
  function fmtC(v) {
    var r = Math.round(v * 10) / 10;
    // M00 is below zero but warmer than -0.5
    if (Object.is(r, -0)) return 'just below 0 °C';
    return (r < 0 ? '−' + Math.abs(r) : String(r)) + ' °C';
  }
  function fmtF(c) { return Math.round(c * 9 / 5 + 32) + ' °F'; }
  function dir3(d) { return pad(d, 3) + '°'; }
  function minutesText(t) {
    return t.length === 4 ? t.slice(0, 2) + ':' + t.slice(2) + ' UTC' : ':' + t + ' past the hour';
  }

  // `bare`: a remark such as RAB15 names the weather without an intensity,
  // so no "moderate" is read into it.
  function weatherText(tok, bare) {
    var m = tok.match(WX_RE);
    if (!m || (!m[2] && !m[3])) return null;
    var inten = m[1] || '', desc = (m[2].match(/../g) || []), phen = (m[3].match(/../g) || []);
    if (phen.indexOf('FC') !== -1 && !phen.filter(function (p) { return p !== 'FC'; }).length) {
      var fc = inten === '+' ? 'Tornado or waterspout' : 'Funnel cloud';
      return inten === 'VC' ? fc + ' in the vicinity' : fc;
    }
    var names = phen.map(function (p) { return PRECIP[p] || OBSC[p] || OTHER[p] || p; });
    var isPrecip = phen.some(function (p) { return PRECIP[p]; });
    // No sign means moderate, which only reads right for precipitation that
    // is falling (rain, snow showers, freezing rain), not for blowing snow.
    var plain = !desc.length || desc.some(function (d) { return d === 'SH' || d === 'TS' || d === 'FZ'; });
    var level = inten === '-' ? 'light ' : inten === '+' ? 'heavy '
      : (isPrecip && inten !== 'VC' && plain && !bare ? 'moderate ' : '');
    var list = names.join(' and ');
    var out;
    if (desc.indexOf('TS') !== -1) {
      out = 'thunderstorm' + (list ? ' with ' + level + list : '');
    } else if (desc.indexOf('SH') !== -1) {
      out = list ? level + list + ' showers' : 'showers';
    } else if (desc.length) {
      var words = desc.map(function (d) { return DESC[d]; }).join(' ');
      out = (level + words + (list ? ' ' + list : '')).trim();
    } else {
      out = level + list;
    }
    if (inten === 'VC') out += ' in the vicinity (5 to 10 SM from the station)';
    return out.charAt(0).toUpperCase() + out.slice(1);
  }

  function category(ceilingFt, visSm) {
    var c = ceilingFt === null || ceilingFt === undefined ? Infinity : ceilingFt;
    var v = visSm === null || visSm === undefined ? Infinity : visSm;
    if (c === Infinity && v === Infinity) return null;
    if (c < 500 || v < 1) return 'LIFR';
    if (c < 1000 || v < 3) return 'IFR';
    if (c <= 3000 || v <= 5) return 'MVFR';
    return 'VFR';
  }

  function decodeRemarks(tokens, out) {
    var rem = out.remarks;
    function add(raw, text) { rem.push({ raw: raw, text: text }); }
    for (var i = 0; i < tokens.length; i++) {
      var t = tokens[i], n = tokens[i + 1] || '', m;
      if ((m = t.match(/^AO([12])(A)?$/))) {
        add(t, m[1] === '2' ? 'Automated station with a precipitation discriminator (it can tell rain from snow)'
          : 'Automated station without a precipitation discriminator (it cannot tell rain from snow)');
      } else if ((m = t.match(/^SLP(\d{3})$/))) {
        var hpa = parseInt(m[1], 10) / 10 + (parseInt(m[1], 10) < 500 ? 1000 : 900);
        add(t, 'Sea-level pressure ' + hpa.toFixed(1) + ' hPa');
      } else if (t === 'SLPNO') {
        add(t, 'Sea-level pressure not available');
      } else if ((m = t.match(/^T([01])(\d{3})([01])(\d{3})$/))) {
        var tt = tenths(m[1], m[2]), dd = tenths(m[3], m[4]);
        out.tempExact = tt; out.dewExact = dd;
        add(t, 'Temperature ' + fmtC(tt) + ', dew point ' + fmtC(dd) + ' (to the tenth)');
      } else if ((m = t.match(/^T([01])(\d{3})$/))) {
        add(t, 'Temperature ' + fmtC(tenths(m[1], m[2])) + ' (to the tenth)');
      } else if ((m = t.match(/^1([01])(\d{3})$/))) {
        add(t, 'Highest temperature in the last 6 hours ' + fmtC(tenths(m[1], m[2])));
      } else if ((m = t.match(/^2([01])(\d{3})$/))) {
        add(t, 'Lowest temperature in the last 6 hours ' + fmtC(tenths(m[1], m[2])));
      } else if ((m = t.match(/^4([01])(\d{3})([01])(\d{3})$/))) {
        add(t, 'Last 24 hours: high ' + fmtC(tenths(m[1], m[2])) + ', low ' + fmtC(tenths(m[3], m[4])));
      } else if ((m = t.match(/^5([0-8])(\d{3})$/))) {
        var chg = parseInt(m[2], 10) / 10;
        var trend = ['rising, then falling', 'rising, then steady', 'rising', 'falling or steady, then rising',
          'steady', 'falling, then rising', 'falling, then steady', 'falling', 'steady or rising, then falling'][+m[1]];
        var net = +m[1] < 4 ? 'higher' : +m[1] > 4 ? 'lower' : 'the same as';
        add(t, 'Pressure ' + trend + ' over 3 hours; now ' + (net === 'the same as' ? 'the same as' : chg.toFixed(1) + ' hPa ' + net + ' than') + ' 3 hours ago');
      } else if ((m = t.match(/^P(\d{4})$/))) {
        add(t, +m[1] === 0 ? 'A trace of precipitation in the last hour' : 'Precipitation in the last hour: ' + (parseInt(m[1], 10) / 100).toFixed(2) + ' in');
      } else if ((m = t.match(/^6(\d{4}|\/{4})$/))) {
        add(t, /\//.test(m[1]) ? 'Precipitation in the last 3 or 6 hours: not measured'
          : +m[1] === 0 ? 'A trace of precipitation in the last 3 or 6 hours'
          : 'Precipitation in the last 3 or 6 hours: ' + (parseInt(m[1], 10) / 100).toFixed(2) + ' in');
      } else if ((m = t.match(/^7(\d{4})$/))) {
        add(t, +m[1] === 0 ? 'A trace of precipitation in the last 24 hours' : 'Precipitation in the last 24 hours: ' + (parseInt(m[1], 10) / 100).toFixed(2) + ' in');
      } else if ((m = t.match(/^4\/(\d{3})$/))) {
        add(t, 'Snow on the ground: ' + parseInt(m[1], 10) + ' in');
      } else if ((m = t.match(/^98(\d{3})$/))) {
        add(t, 'Sunshine yesterday: ' + parseInt(m[1], 10) + ' minutes');
      } else if (t === 'PK' && n === 'WND' && (m = (tokens[i + 2] || '').match(/^(\d{3})(\d{2,3})\/(\d{2})?(\d{2})$/))) {
        add(t + ' ' + n + ' ' + tokens[i + 2], 'Peak wind ' + dir3(+m[1]) + ' at ' + (+m[2]) + ' kt, at ' + (m[3] ? m[3] + ':' + m[4] + ' UTC' : ':' + m[4] + ' past the hour'));
        i += 2;
      } else if (t === 'WSHFT' && (m = n.match(/^(\d{2})?(\d{2})$/))) {
        var fropa = tokens[i + 2] === 'FROPA';
        add(t + ' ' + n + (fropa ? ' FROPA' : ''), 'Wind shift at ' + (m[1] ? m[1] + ':' + m[2] + ' UTC' : ':' + m[2] + ' past the hour') + (fropa ? ', with a front passing' : ''));
        i += fropa ? 2 : 1;
      } else if ((t === 'TWR' || t === 'SFC') && n === 'VIS') {
        var v = visToken(tokens, i + 2);
        if (v) {
          add(tokens.slice(i, i + 2 + v.used).join(' '), (t === 'TWR' ? 'Tower' : 'Surface') + ' visibility ' + v.text);
          i += 1 + v.used;
        } else add(t + ' ' + n, (t === 'TWR' ? 'Tower' : 'Surface') + ' visibility');
      } else if (t === 'VIS' && (m = n.match(/^(\d+(?:\/\d+)?)V(\d+(?:\/\d+)?)$/))) {
        add(t + ' ' + n, 'Visibility varying between ' + m[1] + ' and ' + m[2] + ' SM');
        i += 1;
      } else if (t === 'CIG' && (m = n.match(/^(\d{3})V(\d{3})$/))) {
        add(t + ' ' + n, 'Ceiling varying between ' + fmtInt(+m[1] * 100) + ' and ' + fmtInt(+m[2] * 100) + ' ft');
        i += 1;
      } else if (t === 'PRESRR' || t === 'PRESFR') {
        add(t, 'Pressure ' + (t === 'PRESRR' ? 'rising' : 'falling') + ' rapidly');
      } else if (t === 'FROPA') {
        add(t, 'A front is passing');
      } else if (t === 'VIRGA') {
        var vw = where(tokens, i + 1);
        add(t + (vw.raw ? ' ' + vw.raw : ''), 'Virga: precipitation falling from cloud and evaporating before the ground' + (vw.text ? ', ' + vw.text : ''));
        i += vw.used;
      } else if (/^(TSNO|RVRNO|PWINO|PNO|FZRANO|VISNO|CHINO)$/.test(t)) {
        var what = { TSNO: 'Lightning detector', RVRNO: 'Runway visual range', PWINO: 'Present-weather sensor',
          PNO: 'Precipitation gauge', FZRANO: 'Freezing-rain sensor', VISNO: 'Second visibility sensor',
          CHINO: 'Second ceiling sensor' }[t];
        add(t, what + ' not available');
      } else if (t === '$') {
        add(t, 'The station needs maintenance: treat its readings with care');
      } else if (/^(OCNL|FRQ|CONS)$/.test(t) && /^LTG/.test(n)) {
        var lw = where(tokens, i + 2);
        add(t + ' ' + n + (lw.raw ? ' ' + lw.raw : ''), { OCNL: 'Occasional', FRQ: 'Frequent', CONS: 'Continuous' }[t] +
          ' lightning' + ltgKinds(n.slice(3)) + (lw.text ? ', ' + lw.text : ''));
        i += 1 + lw.used;
      } else if (/^LTG/.test(t)) {
        var lw2 = where(tokens, i + 1);
        add(t + (lw2.raw ? ' ' + lw2.raw : ''), 'Lightning' + ltgKinds(t.slice(3)) + (lw2.text ? ', ' + lw2.text : ''));
        i += lw2.used;
      } else if (WHERE[t] || compassText(t)) {
        var sw = where(tokens, i);
        add(sw.raw, sw.text.charAt(0).toUpperCase() + sw.text.slice(1));
        i += sw.used - 1;
      } else if ((m = t.match(/^((?:(?:ACC|TCU|[A-Z]{2})\d)+)$/)) && opacity(m[1])) {
        add(t, 'Cloud layers, lowest first: ' + opacity(m[1]));
      } else if (t === 'DENSITY' && n === 'ALT' && (m = (tokens[i + 2] || '').match(/^(-?\d+)FT$/))) {
        add(t + ' ' + n + ' ' + tokens[i + 2], 'Density altitude ' + fmtInt(+m[1]) + ' ft');
        i += 2;
      } else if (beginEnd(t)) {
        add(t, beginEnd(t));
      } else if (weatherText(t)) {
        add(t, weatherText(t));
      } else if ((m = t.match(/^(CB|TCU|ACC|CBMAM|ACSL|SCSL|CCSL)$/))) {
        var cw = where(tokens, i + 1);
        add(t + (cw.raw ? ' ' + cw.raw : ''), { CB: 'Cumulonimbus', TCU: 'Towering cumulus', ACC: 'Altocumulus castellanus',
          CBMAM: 'Cumulonimbus mammatus', ACSL: 'Standing lenticular altocumulus (mountain wave)',
          SCSL: 'Standing lenticular stratocumulus (mountain wave)',
          CCSL: 'Standing lenticular cirrocumulus (mountain wave)' }[t] + (cw.text ? ', ' + cw.text : ''));
        i += cw.used;
      } else if (t === 'MOV' && COMPASS[n]) {
        add(t + ' ' + n, 'Moving ' + COMPASS[n]);
        i += 1;
      } else {
        add(t, null);
        out.unknown.push(t);
      }
    }
  }

  // The words after a phenomenon in remarks that say where it is and where
  // it is going: LTG DSNT NE-SE, CB OHD MOV E.
  var WHERE = { DSNT: 'distant (more than 10 SM)', VC: 'in the vicinity (5 to 10 SM)',
    OHD: 'overhead', ALQDS: 'in all quadrants', AND: 'and' };
  function compassText(w) {
    if (!/^[NSEW]{1,2}(-[NSEW]{1,2})*$/.test(w)) return null;
    var parts = w.split('-');
    for (var k = 0; k < parts.length; k++) if (!COMPASS[parts[k]]) return null;
    return 'to the ' + parts.map(function (x) { return COMPASS[x]; }).join(' through ');
  }
  function where(tokens, i) {
    var parts = [], j = i;
    for (; j < tokens.length; j++) {
      var w = tokens[j], c = compassText(w);
      if (WHERE[w]) parts.push(WHERE[w]);
      else if (c) parts.push(c);
      else if (w === 'MOV' && COMPASS[tokens[j + 1]]) { parts.push('moving ' + COMPASS[tokens[j + 1]]); j++; }
      else break;
    }
    return { used: j - i, raw: tokens.slice(i, j).join(' '), text: parts.join(', ').replace(/, and, /g, ' and ') };
  }

  function ltgKinds(s) {
    var k = { IC: 'in cloud', CC: 'cloud to cloud', CG: 'cloud to ground', CA: 'cloud to air' };
    var parts = (s.match(/(IC|CC|CG|CA)/g) || []).map(function (x) { return k[x]; });
    return parts.length ? ' (' + parts.join(', ') + ')' : '';
  }

  function opacity(s) {
    var parts = s.match(/(ACC|TCU|[A-Z]{2})(\d)/g) || [];
    var out = [];
    for (var i = 0; i < parts.length; i++) {
      var m = parts[i].match(/^(ACC|TCU|[A-Z]{2})(\d)$/);
      if (!CLOUD_TYPES[m[1]]) return null;
      out.push(CLOUD_TYPES[m[1]] + ' ' + m[2] + '/8');
    }
    return out.join(', ');
  }

  function beginEnd(t) {
    if (!/^(?:(?:[A-Z]{2}){1,3}(?:[BE]\d{2}(?:\d{2})?)+)+$/.test(t)) return null;
    var re = /((?:[A-Z]{2}){1,3}?)((?:[BE]\d{2}(?:\d{2})?)+)/g, m, out = [];
    while ((m = re.exec(t))) {
      var what = weatherText(m[1], true);
      if (!what) return null;
      var ev = m[2].match(/[BE]\d{2}(?:\d{2})?/g).map(function (e) {
        return (e.charAt(0) === 'B' ? 'began ' : 'ended ') + (e.length === 5 ? 'at ' + e.slice(1, 3) + ':' + e.slice(3) + ' UTC' : 'at ' + minutesText(e.slice(1)));
      });
      out.push(what + ' ' + ev.join(' and '));
    }
    return out.length ? out.join('; ') : null;
  }

  // Visibility in statute miles starting at tokens[i]: "10SM", "1/2SM",
  // "1 1/2SM" (two tokens), "P6SM", "M1/4SM". In the body the SM is required
  // (22/09 is a temperature, not a fraction); in remarks ("TWR VIS 1 1/2")
  // a bare number is a visibility.
  function visToken(tokens, i) {
    var t = tokens[i] || '', n = tokens[i + 1] || '', m;
    var bare = tokens === REMARK_TOKENS;
    if (/^\d$/.test(t) && (m = n.match(/^(\d)\/(\d{1,2})(SM)?$/)) && (m[3] || bare) && +m[2]) {
      var v = +t + m[1] / m[2];
      return { sm: v, used: 2, text: t + ' ' + m[1] + '/' + m[2] + ' SM', raw: t + ' ' + n };
    }
    if ((m = t.match(/^([MP])?(\d+)\/(\d+)(SM)?$/)) && +m[3] && (m[4] || bare)) {
      return { sm: m[2] / m[3], less: m[1] === 'M', more: m[1] === 'P', used: 1,
        text: (m[1] === 'M' ? 'less than ' : m[1] === 'P' ? 'more than ' : '') + m[2] + '/' + m[3] + ' SM', raw: t };
    }
    if ((m = t.match(/^([MP])?(\d+)(SM)?$/)) && (m[3] || bare)) {
      return { sm: +m[2], less: m[1] === 'M', more: m[1] === 'P', used: 1,
        text: (m[1] === 'M' ? 'less than ' : m[1] === 'P' ? 'more than ' : '') + m[2] + ' SM', raw: t };
    }
    return null;
  }
  var REMARK_TOKENS = null;

  function decode(text) {
    var out = { ok: false, raw: '', type: null, station: null, time: null, auto: false, cor: false,
      nil: false, wind: null, visibility: null, cavok: false, rvr: [], weather: [], clouds: [],
      sky: null, ceiling: null, temp: null, dew: null, spread: null, rh: null, altimeter: null,
      remarks: [], trend: null, unknown: [], groups: [], category: null, region: null };
    // A paste of several reports decodes the first. A report wrapped over
    // several lines (continuation lines do not start a new report) is joined.
    var lines = String(text || '').toUpperCase().split(/\r?\n/);
    var kept = [];
    for (var li = 0; li < lines.length; li++) {
      var line = lines[li].trim();
      if (!line) { if (kept.length) break; continue; }
      if (kept.length && /^(?:METAR|SPECI)\b|^[A-Z][A-Z0-9]{3}\s+\d{6}Z\b/.test(line)) break;
      kept.push(line);
    }
    var src = kept.join(' ').replace(/\t+/g, ' ').replace(/=+\s*$/, '').trim();
    out.raw = src;
    if (!src) return out;
    var all = src.split(/\s+/);
    var rmk = all.indexOf('RMK');
    var body = rmk === -1 ? all : all.slice(0, rmk);
    var rest = rmk === -1 ? [] : all.slice(rmk + 1);
    var g = out.groups;
    function group(raw, label, txt) { g.push({ raw: raw, label: label, text: txt }); }
    var i = 0, m;

    if (body[i] === 'METAR' || body[i] === 'SPECI') {
      out.type = body[i];
      group(body[i], 'Report type', body[i] === 'SPECI' ? 'Special report, issued between the routine hourly ones because something changed' : 'Routine weather report');
      i++;
    }
    if (body[i] && /^[A-Z][A-Z0-9]{3}$/.test(body[i]) && !/^(AUTO|CAVOK)$/.test(body[i])) {
      out.station = body[i];
      for (var r = 0; r < REGIONS.length; r++) {
        if (out.station.indexOf(REGIONS[r][0]) === 0) { out.region = REGIONS[r][1]; break; }
      }
      group(body[i], 'Station', out.station + (out.region ? ', a station in ' + out.region : ''));
      i++;
    }
    if (body[i] && (m = body[i].match(/^(\d{2})(\d{2})(\d{2})Z$/))) {
      out.time = { day: +m[1], hour: +m[2], minute: +m[3] };
      group(body[i], 'Time', 'Observed on the ' + ordinal(+m[1]) + ' at ' + m[2] + ':' + m[3] + ' UTC');
      i++;
    }
    for (; i < body.length; i++) {
      var t = body[i], n = body[i + 1] || '';
      if (t === 'AUTO') {
        out.auto = true;
        group(t, 'Automated', 'Fully automated report, with no human observer');
      } else if (t === 'COR' || /^CC[A-Z]$/.test(t)) {
        out.cor = true;
        group(t, 'Corrected', 'A correction to an earlier report');
      } else if (t === 'NIL') {
        out.nil = true;
        group(t, 'No report', 'The report is missing');
      } else if (t === 'RTD') {
        group(t, 'Delayed', 'A delayed routine report');
      } else if ((m = t.match(/^(\d{3}|VRB|\/{3})(\d{2,3}|\/{2})(?:G(\d{2,3}))?(KT|MPS|KMH)$/))) {
        var unit = m[4], toKt = unit === 'MPS' ? 1.94384 : unit === 'KMH' ? 0.539957 : 1;
        var w = { dir: /^\d/.test(m[1]) ? +m[1] : null, speed: /\d/.test(m[2]) ? +m[2] : null,
          gust: m[3] ? +m[3] : null, unit: unit, variable: m[1] === 'VRB', varFrom: null, varTo: null };
        w.calm = w.dir === 0 && w.speed === 0;
        w.speedKt = w.speed === null ? null : Math.round(w.speed * toKt);
        w.gustKt = w.gust === null ? null : Math.round(w.gust * toKt);
        var u = unit === 'KT' ? ' kt' : unit === 'MPS' ? ' m/s (' + w.speedKt + ' kt)' : ' km/h (' + w.speedKt + ' kt)';
        var wt;
        if (w.speed === null) wt = 'Wind not measured';
        else if (w.calm) wt = 'Calm';
        else wt = (w.variable ? 'Variable in direction' : 'From ' + dir3(w.dir) + ' true') + ', ' + w.speed + u + (w.gust ? ', gusting to ' + w.gust + (unit === 'KT' ? ' kt' : '') : '');
        out.wind = w;
        var raw = t;
        if ((m = n.match(/^(\d{3})V(\d{3})$/))) {
          w.varFrom = +m[1]; w.varTo = +m[2];
          wt += '; direction varying between ' + dir3(w.varFrom) + ' and ' + dir3(w.varTo);
          raw += ' ' + n;
          i++;
        }
        group(raw, 'Wind', wt);
      } else if (t === 'CAVOK') {
        out.cavok = true;
        out.visibility = { sm: 10000 / 1609.344, more: true, text: '10 km or more' };
        group(t, 'CAVOK', 'Ceiling and visibility OK: visibility 10 km or more, no cloud below 5,000 ft or the highest minimum sector altitude, no cumulonimbus or towering cumulus, no significant weather');
      } else if (visToken(body, i)) {
        var v = visToken(body, i);
        // US reports stop at 10 SM, so 10SM there means 10 or more. Canadian
        // observers report higher values (15SM), so theirs is a plain number.
        v.atLeast = v.sm === 10 && !v.less && !/^C/.test(out.station || '');
        out.visibility = v;
        group(v.raw, 'Visibility', v.atLeast ? v.text + ' or more' : v.text);
        i += v.used - 1;
      } else if (/^\/{4}SM$/.test(t)) {
        group(t, 'Visibility', 'Not measured');
      } else if ((m = t.match(/^(\d{4})(NDV)?$/)) && !out.clouds.length && out.temp === null) {
        var meters = +m[1];
        out.visibility = { sm: meters / 1609.344, more: meters === 9999, text: meters === 9999 ? '10 km or more' : fmtInt(meters) + ' m (' + (Math.round(meters / 1609.344 * 10) / 10) + ' SM)' };
        group(t, 'Visibility', out.visibility.text + (m[2] ? '; the sensor cannot report direction' : ''));
      } else if ((m = t.match(/^(\d{4})(N|NE|E|SE|S|SW|W|NW)$/))) {
        group(t, 'Visibility', 'Lowest visibility ' + fmtInt(+m[1]) + ' m, toward the ' + COMPASS[m[2]]);
      } else if ((m = t.match(/^R(\d{2}[LRC]?)\/([MP])?(\d{4})(?:V([MP])?(\d{4}))?(FT)?(?:\/?([UDN]))?$/))) {
        var ft = m[6] === 'FT' ? ' ft' : ' m';
        var val = function (pm, d) { return (pm === 'M' ? 'less than ' : pm === 'P' ? 'more than ' : '') + fmtInt(+d) + ft; };
        var rt = 'Runway ' + m[1] + ' visual range ' + (m[5] ? 'varying from ' + val(m[2], m[3]) + ' to ' + val(m[4], m[5]) : val(m[2], m[3])) +
          (m[7] ? ', ' + { U: 'improving', D: 'getting worse', N: 'no change' }[m[7]] : '');
        out.rvr.push({ runway: m[1], text: rt });
        group(t, 'Runway visual range', rt);
      } else if ((m = t.match(/^(FEW|SCT|BKN|OVC)(\d{3}|\/{3})(CB|TCU|\/{3})?$/))) {
        var base = /\d/.test(m[2]) ? +m[2] * 100 : null;
        var layer = { cover: m[1], base: base, type: m[3] && m[3] !== '///' ? m[3] : null };
        out.clouds.push(layer);
        var ct = COVER[m[1]] + ' (' + OKTAS[m[1]] + ')' + (base === null ? ', base not measured' : ' at ' + fmtInt(base) + ' ft above the ground') +
          (layer.type === 'CB' ? ', cumulonimbus' : layer.type === 'TCU' ? ', towering cumulus' : '');
        if ((m[1] === 'BKN' || m[1] === 'OVC') && base !== null && (out.ceiling === null || base < out.ceiling.ft)) {
          out.ceiling = { ft: base, layer: t };
        }
        group(t, 'Clouds', ct);
      } else if ((m = t.match(/^VV(\d{3}|\/{3})$/))) {
        var vv = /\d/.test(m[1]) ? +m[1] * 100 : null;
        out.clouds.push({ cover: 'VV', base: vv, type: null });
        if (vv !== null && (out.ceiling === null || vv < out.ceiling.ft)) out.ceiling = { ft: vv, layer: t };
        group(t, 'Vertical visibility', 'Sky obscured; vertical visibility ' + (vv === null ? 'not measured' : fmtInt(vv) + ' ft') + ', which counts as the ceiling');
      } else if (/^(CLR|SKC|NSC|NCD)$/.test(t)) {
        out.sky = t;
        group(t, 'Sky', { CLR: 'Clear below 12,000 ft (an automated sensor sees no higher)', SKC: 'Sky clear',
          NSC: 'No significant cloud', NCD: 'No cloud detected by the automated sensor' }[t]);
      } else if ((m = t.match(/^(M?\d{2}|\/\/)\/(M?\d{2}|\/\/)?$/))) {
        out.temp = tempOf(m[1]);
        out.dew = tempOf(m[2]);
        var tp = out.temp === null ? 'Temperature not measured' : 'Temperature ' + fmtC(out.temp) + ' (' + fmtF(out.temp) + ')';
        if (out.dew !== null) tp += ', dew point ' + fmtC(out.dew);
        if (out.temp !== null && out.dew !== null) {
          out.spread = out.temp - out.dew;
          out.rh = Math.round(100 * Math.exp(17.625 * out.dew / (243.04 + out.dew)) / Math.exp(17.625 * out.temp / (243.04 + out.temp)));
          tp += '; spread ' + out.spread + ' °C, relative humidity about ' + out.rh + '%';
        }
        group(t, 'Temperature', tp);
      } else if ((m = t.match(/^A(\d{4})$/))) {
        var inhg = +m[1] / 100;
        out.altimeter = { inHg: inhg, hPa: Math.round(inhg * 33.8639) };
        group(t, 'Altimeter', inhg.toFixed(2) + ' inHg (' + out.altimeter.hPa + ' hPa)');
      } else if ((m = t.match(/^Q(\d{4})$/))) {
        var hp = +m[1];
        out.altimeter = { inHg: Math.round(hp * 0.0295300 * 100) / 100, hPa: hp };
        group(t, 'Altimeter', hp + ' hPa (' + out.altimeter.inHg.toFixed(2) + ' inHg)');
      } else if (t === 'NOSIG') {
        group(t, 'Trend', 'No significant change expected in the next 2 hours');
      } else if (t === 'BECMG' || t === 'TEMPO') {
        out.trend = body.slice(i).join(' ');
        group(out.trend, 'Trend', (t === 'BECMG' ? 'Becoming' : 'Temporarily') + ' in the next 2 hours: ' + body.slice(i + 1).join(' '));
        break;
      } else if (t === 'WS' && /^(R\d{2}[LRC]?|ALL)$/.test(n)) {
        var wsRaw = t + ' ' + n + (n === 'ALL' && body[i + 2] === 'RWY' ? ' RWY' : '');
        group(wsRaw, 'Wind shear', 'Wind shear reported on ' + (n === 'ALL' ? 'all runways' : 'runway ' + n.slice(1)));
        i += wsRaw.split(' ').length - 1;
      } else if ((m = t.match(/^RE(.+)$/)) && weatherText(m[1])) {
        group(t, 'Recent weather', weatherText(m[1]) + ' since the last report');
      } else if (weatherText(t)) {
        var wtx = weatherText(t);
        out.weather.push({ raw: t, text: wtx });
        group(t, 'Weather', wtx);
      } else if (/^\/\/+$/.test(t)) {
        group(t, 'Not measured', 'The automated station could not report this group');
      } else {
        out.unknown.push(t);
        group(t, 'Not decoded', null);
      }
    }
    if (rest.length) {
      REMARK_TOKENS = rest;
      decodeRemarks(rest, out);
      REMARK_TOKENS = null;
      group('RMK', 'Remarks', 'Remarks follow');
      out.remarks.forEach(function (x) { group(x.raw, 'Remark', x.text); });
    }
    out.ok = !!(out.station && (out.time || out.wind || out.visibility || out.clouds.length));
    if (out.cavok && !out.ceiling) out.category = 'VFR';
    else {
      var visSm = out.visibility ? (out.visibility.less ? out.visibility.sm - 0.01 : out.visibility.sm) : null;
      var ceil = out.ceiling ? out.ceiling.ft : null;
      // A report with visibility but no cloud group (CLR, SKC) has no ceiling.
      out.category = category(ceil, visSm);
    }
    return out;
  }

  return { decode: decode, category: category, weatherText: weatherText };
});
