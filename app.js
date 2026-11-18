/* Apex Voice - spoken narration from a script, using the browser's own voices.
 *
 * Nothing is uploaded, and nothing is recorded: the Web Speech API speaks a
 * string and cannot hand back its audio, so this app cannot export a sound
 * file. It narrates live and keeps the scripts you save.
 *
 *   localStorage  apex.voice.v1  { settings, snippets }
 */
(function () {
  'use strict';

  var KEY = 'apex.voice.v1';
  var MAX_SNIPPETS = 40;
  var WORDS_PER_MINUTE = 165;
  var synth = window.speechSynthesis || null;

  var el = {
    statLine: document.getElementById('statLine'),
    scriptInput: document.getElementById('scriptInput'),
    countLine: document.getElementById('countLine'),
    speakBtn: document.getElementById('speakBtn'),
    progressTrack: document.getElementById('progressTrack'),
    progressBar: document.getElementById('progressBar'),
    progressText: document.getElementById('progressText'),
    pauseBtn: document.getElementById('pauseBtn'),
    stopBtn: document.getElementById('stopBtn'),
    voiceSelect: document.getElementById('voiceSelect'),
    voiceNote: document.getElementById('voiceNote'),
    rateRange: document.getElementById('rateRange'),
    rateValue: document.getElementById('rateValue'),
    pitchRange: document.getElementById('pitchRange'),
    pitchValue: document.getElementById('pitchValue'),
    volumeRange: document.getElementById('volumeRange'),
    volumeValue: document.getElementById('volumeValue'),
    snippetName: document.getElementById('snippetName'),
    saveBtn: document.getElementById('saveBtn'),
    snippetList: document.getElementById('snippetList'),
    snippetsEmpty: document.getElementById('snippetsEmpty'),
    unsupported: document.getElementById('unsupported'),
    toast: document.getElementById('toast')
  };

  var state = {
    settings: { voiceURI: '', rate: 1, pitch: 1, volume: 1 },
    snippets: []
  };

  var voices = [];
  var mode = 'idle';          // idle | speaking | paused
  var cancelled = false;
  var utter = null;

  /* ---------- storage ---------- */

  function load() {
    var raw = null;
    try {
      raw = JSON.parse(localStorage.getItem(KEY) || 'null');
    } catch (err) {
      raw = null;
    }
    if (!raw || typeof raw !== 'object') raw = {};

    var s = raw.settings && typeof raw.settings === 'object' ? raw.settings : {};
    state.settings = {
      voiceURI: typeof s.voiceURI === 'string' ? s.voiceURI : '',
      rate: clamp(Number(s.rate) || 1, 0.5, 2),
      pitch: clamp(Number(s.pitch) || 1, 0, 2),
      volume: Number.isFinite(Number(s.volume)) ? clamp(Number(s.volume), 0, 1) : 1
    };

    state.snippets = (Array.isArray(raw.snippets) ? raw.snippets : []).filter(function (x) {
      return x && typeof x.text === 'string' && x.text.trim();
    }).map(function (x) {
      return {
        id: x.id || uid(),
        name: typeof x.name === 'string' && x.name ? x.name : 'Untitled',
        text: x.text,
        voiceURI: typeof x.voiceURI === 'string' ? x.voiceURI : '',
        rate: clamp(Number(x.rate) || 1, 0.5, 2),
        pitch: clamp(Number(x.pitch) || 1, 0, 2),
        volume: Number.isFinite(Number(x.volume)) ? clamp(Number(x.volume), 0, 1) : 1,
        createdAt: Number(x.createdAt) || 0
      };
    }).slice(0, MAX_SNIPPETS);
  }

  function save() {
    try {
      localStorage.setItem(KEY, JSON.stringify(state));
    } catch (err) {
      toast('Could not save - device storage may be full');
    }
  }

  function clamp(n, lo, hi) {
    return Math.min(hi, Math.max(lo, n));
  }

  function uid() {
    return Date.now().toString(36) + Math.random().toString(36).slice(2, 7);
  }

  /* ---------- helpers ---------- */

  function toast(msg) {
    el.toast.textContent = msg;
    el.toast.hidden = false;
    clearTimeout(toast.timer);
    toast.timer = setTimeout(function () { el.toast.hidden = true; }, 3200);
  }

  function words(text) {
    var parts = String(text || '').trim().split(/\s+/);
    return parts.length && parts[0] ? parts.length : 0;
  }

  function estimate(text, rate) {
    var count = words(text);
    if (!count) return '';
    var seconds = (count / (WORDS_PER_MINUTE * rate)) * 60;
    if (seconds < 60) return Math.max(1, Math.round(seconds)) + 's';
    var minutes = Math.floor(seconds / 60);
    var rest = Math.round(seconds % 60);
    return minutes + 'm ' + (rest < 10 ? '0' : '') + rest + 's';
  }

  function refreshCounts() {
    var text = el.scriptInput.value;
    var count = words(text);
    el.countLine.textContent = text.length + (text.length === 1 ? ' character' : ' characters') +
      ' \u00B7 ' + count + (count === 1 ? ' word' : ' words') +
      (count ? ' \u00B7 about ' + estimate(text, rateValue()) : '');
  }

  function rateValue() { return Number(el.rateRange.value) || 1; }

  function currentVoice() {
    var uri = el.voiceSelect.value;
    for (var i = 0; i < voices.length; i++) {
      if (voices[i].voiceURI === uri) return voices[i];
    }
    return voices[0] || null;
  }

  function setProgress(pct) {
    var value = clamp(Math.round(pct), 0, 100);
    el.progressBar.style.width = value + '%';
    el.progressTrack.setAttribute('aria-valuenow', String(value));
  }

  function setMode(next) {
    mode = next;
    var speaking = next === 'speaking';
    var paused = next === 'paused';
    el.speakBtn.textContent = speaking || paused ? 'Restart' : 'Speak';
    el.pauseBtn.disabled = next === 'idle';
    el.pauseBtn.textContent = paused ? 'Resume' : 'Pause';
    el.stopBtn.disabled = next === 'idle';
    el.statLine.textContent = speaking
      ? 'Speaking\u2026'
      : paused
        ? 'Paused'
        : 'Turn a script into spoken narration.';
  }

  /* ---------- voices ---------- */

  function fillVoices() {
    if (!synth) return;
    voices = synth.getVoices().slice();
    el.voiceSelect.textContent = '';

    if (!voices.length) {
      var opt = document.createElement('option');
      opt.value = '';
      opt.textContent = 'No voices installed';
      el.voiceSelect.appendChild(opt);
      el.voiceSelect.disabled = true;
      el.voiceNote.hidden = false;
      el.speakBtn.disabled = true;
      return;
    }

    el.voiceSelect.disabled = false;
    el.voiceNote.hidden = true;
    el.speakBtn.disabled = false;

    var groups = {};
    var order = [];
    voices.forEach(function (v) {
      var lang = v.lang || 'Other';
      if (!groups[lang]) { groups[lang] = []; order.push(lang); }
      groups[lang].push(v);
    });

    order.sort();
    order.forEach(function (lang) {
      var group = document.createElement('optgroup');
      group.label = lang;
      groups[lang].forEach(function (v) {
        var opt = document.createElement('option');
        opt.value = v.voiceURI;
        opt.textContent = v.name + (v.default ? ' (default)' : '');
        group.appendChild(opt);
      });
      el.voiceSelect.appendChild(group);
    });

    var preferred = state.settings.voiceURI;
    var found = voices.some(function (v) { return v.voiceURI === preferred; });
    if (!found) {
      var fallback = voices.filter(function (v) { return /^en/i.test(v.lang); })[0] || voices[0];
      preferred = fallback ? fallback.voiceURI : '';
    }
    el.voiceSelect.value = preferred;
    state.settings.voiceURI = preferred;
  }

  /* ---------- narration ---------- */

  function stop(reset) {
    cancelled = true;
    utter = null;
    if (synth) synth.cancel();
    if (reset !== false) {
      setProgress(0);
      el.progressText.textContent = 'Stopped';
      setMode('idle');
    }
  }

  function speak() {
    if (!synth) return;
    var text = el.scriptInput.value.trim();
    if (!text) {
      toast('Write something to speak first');
      el.scriptInput.focus();
      return;
    }
    var voice = currentVoice();
    if (!voice) {
      toast('No voices installed - nothing to speak with');
      return;
    }

    stop(false);
    cancelled = false;

    var u = new SpeechSynthesisUtterance(text);
    u.voice = voice;
    u.lang = voice.lang;
    u.rate = rateValue();
    u.pitch = Number(el.pitchRange.value) || 1;
    u.volume = Number(el.volumeRange.value);
    if (!Number.isFinite(u.volume)) u.volume = 1;

    u.onstart = function () {
      setMode('speaking');
      el.progressText.textContent = voice.name;
    };

    u.onboundary = function (event) {
      if (typeof event.charIndex !== 'number' || !text.length) return;
      setProgress((event.charIndex / text.length) * 100);
    };

    u.onpause = function () { setMode('paused'); };

    u.onresume = function () { setMode('speaking'); };

    u.onend = function () {
      if (utter !== u) return;
      utter = null;
      setProgress(100);
      el.progressText.textContent = 'Finished';
      setMode('idle');
    };

    u.onerror = function (event) {
      if (utter !== u) return;
      if (cancelled || (event && (event.error === 'interrupted' || event.error === 'canceled'))) return;
      utter = null;
      setMode('idle');
      setProgress(0);
      el.progressText.textContent = 'Could not speak';
      toast('That voice stopped: ' + ((event && event.error) || 'unknown error'));
    };

    utter = u;
    setProgress(0);
    el.progressText.textContent = 'Starting\u2026';
    synth.speak(u);
  }

  function togglePause() {
    if (!synth || mode === 'idle') return;
    if (mode === 'paused') {
      synth.resume();
      setMode('speaking');
    } else {
      synth.pause();
      setMode('paused');
    }
  }

  /* ---------- saved scripts ---------- */

  function paintSnippets() {
    el.snippetList.textContent = '';
    el.snippetsEmpty.hidden = state.snippets.length !== 0;

    state.snippets.slice().sort(function (a, b) { return b.createdAt - a.createdAt; }).forEach(function (snip) {
      var li = document.createElement('li');
      li.className = 'snippet';

      var meta = document.createElement('span');
      meta.className = 'meta';
      var name = document.createElement('span');
      name.className = 'name';
      name.textContent = snip.name;
      var sub = document.createElement('span');
      sub.className = 'sub';
      sub.textContent = words(snip.text) + (words(snip.text) === 1 ? ' word' : ' words') +
        ' \u00B7 ' + (voiceName(snip.voiceURI) || 'saved voice') +
        ' \u00B7 ' + snip.rate.toFixed(1) + '\u00D7';
      meta.appendChild(name);
      meta.appendChild(sub);

      var loadBtn = document.createElement('button');
      loadBtn.type = 'button';
      loadBtn.className = 'mini';
      loadBtn.textContent = 'Load';
      loadBtn.addEventListener('click', function () { loadSnippet(snip); });

      var delBtn = document.createElement('button');
      delBtn.type = 'button';
      delBtn.className = 'mini danger';
      delBtn.textContent = 'Delete';
      delBtn.setAttribute('aria-label', 'Delete ' + snip.name);
      delBtn.addEventListener('click', function () {
        state.snippets = state.snippets.filter(function (x) { return x.id !== snip.id; });
        save();
        paintSnippets();
        toast('Deleted ' + snip.name);
      });

      li.appendChild(meta);
      li.appendChild(loadBtn);
      li.appendChild(delBtn);
      el.snippetList.appendChild(li);
    });
  }

  function voiceName(uri) {
    for (var i = 0; i < voices.length; i++) {
      if (voices[i].voiceURI === uri) return voices[i].name;
    }
    return '';
  }

  function loadSnippet(snip) {
    stop(false);
    el.scriptInput.value = snip.text;
    el.rateRange.value = String(snip.rate);
    el.pitchRange.value = String(snip.pitch);
    el.volumeRange.value = String(snip.volume);
    state.settings.rate = snip.rate;
    state.settings.pitch = snip.pitch;
    state.settings.volume = snip.volume;
    if (snip.voiceURI && voiceName(snip.voiceURI)) {
      el.voiceSelect.value = snip.voiceURI;
      state.settings.voiceURI = snip.voiceURI;
    }
    el.snippetName.value = snip.name;
    paintValues();
    refreshCounts();
    setProgress(0);
    el.progressText.textContent = 'Ready';
    save();
    toast('Loaded ' + snip.name);
  }

  function saveSnippet() {
    var text = el.scriptInput.value.trim();
    if (!text) {
      toast('Write something to save first');
      el.scriptInput.focus();
      return;
    }
    var name = el.snippetName.value.trim() || text.slice(0, 32).trim() || 'Untitled';
    var existing = state.snippets.filter(function (x) { return x.name === name; })[0];
    var record = {
      id: existing ? existing.id : uid(),
      name: name,
      text: text,
      voiceURI: el.voiceSelect.value || '',
      rate: rateValue(),
      pitch: Number(el.pitchRange.value) || 1,
      volume: Number(el.volumeRange.value),
      createdAt: Date.now()
    };
    if (!Number.isFinite(record.volume)) record.volume = 1;

    if (existing) {
      state.snippets = state.snippets.map(function (x) { return x.id === existing.id ? record : x; });
    } else {
      state.snippets.unshift(record);
      if (state.snippets.length > MAX_SNIPPETS) state.snippets = state.snippets.slice(0, MAX_SNIPPETS);
    }
    save();
    paintSnippets();
    el.snippetName.value = '';
    toast((existing ? 'Updated ' : 'Saved ') + name);
  }

  /* ---------- wiring ---------- */

  function paintValues() {
    el.rateValue.textContent = rateValue().toFixed(1) + '\u00D7';
    el.pitchValue.textContent = (Number(el.pitchRange.value) || 0).toFixed(1);
    el.volumeValue.textContent = Math.round((Number(el.volumeRange.value) || 0) * 100) + '%';
  }

  el.scriptInput.addEventListener('input', refreshCounts);

  el.speakBtn.addEventListener('click', speak);
  el.pauseBtn.addEventListener('click', togglePause);
  el.stopBtn.addEventListener('click', function () {
    stop(true);
    el.progressText.textContent = 'Stopped';
  });

  el.voiceSelect.addEventListener('change', function () {
    state.settings.voiceURI = el.voiceSelect.value;
    save();
  });

  el.rateRange.addEventListener('input', function () {
    state.settings.rate = rateValue();
    paintValues();
    refreshCounts();
    save();
  });

  el.pitchRange.addEventListener('input', function () {
    state.settings.pitch = Number(el.pitchRange.value) || 1;
    paintValues();
    save();
  });

  el.volumeRange.addEventListener('input', function () {
    state.settings.volume = Number(el.volumeRange.value);
    paintValues();
    save();
  });

  el.saveBtn.addEventListener('click', saveSnippet);

  el.snippetName.addEventListener('keydown', function (event) {
    if (event.key === 'Enter') {
      event.preventDefault();
      saveSnippet();
    }
  });

  document.addEventListener('keydown', function (event) {
    if ((event.ctrlKey || event.metaKey) && event.key === 'Enter') {
      event.preventDefault();
      speak();
    }
    if (event.key === 'Escape' && mode !== 'idle') {
      stop(true);
      el.progressText.textContent = 'Stopped';
    }
  });

  window.addEventListener('pagehide', function () {
    if (synth) synth.cancel();
  });

  if ('serviceWorker' in navigator) {
    window.addEventListener('load', function () {
      navigator.serviceWorker.register('./sw.js').catch(function () {});
    });
  }

  /* ---------- boot ---------- */

  if (!synth || typeof SpeechSynthesisUtterance === 'undefined') {
    el.unsupported.hidden = false;
    el.speakBtn.disabled = true;
    el.pauseBtn.disabled = true;
    el.stopBtn.disabled = true;
    el.voiceSelect.disabled = true;
    el.scriptInput.disabled = true;
    el.statLine.textContent = 'Speech is unavailable in this browser';
    el.voiceNote.hidden = true;
    load();
    paintSnippets();
    return;
  }

  load();

  el.rateRange.value = String(state.settings.rate);
  el.pitchRange.value = String(state.settings.pitch);
  el.volumeRange.value = String(state.settings.volume);
  paintValues();
  refreshCounts();
  setMode('idle');
  setProgress(0);
  paintSnippets();
  fillVoices();

  if (typeof synth.addEventListener === 'function') {
    synth.addEventListener('voiceschanged', fillVoices);
  } else {
    synth.onvoiceschanged = fillVoices;
  }

  /* Some browsers return an empty list until voiceschanged fires; ask again
     once shortly after load so the select is not left on "No voices". */
  setTimeout(function () {
    if (!voices.length) fillVoices();
  }, 350);
})();
