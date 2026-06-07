'use strict';

/**
 * Parse une saisie de nombres avec plages : "10,20,230-240" → [10,20,230,...,240].
 * Déduplique, trie, et borne les valeurs entre opts.min (def. 1) et opts.max (def. 4094).
 * Accepte aussi un tableau en entrée (re-normalisé).
 */
function parseRanges(input, opts) {
  opts = opts || {};
  var min = opts.min !== undefined ? opts.min : 1;
  var max = opts.max !== undefined ? opts.max : 4094;
  if (Array.isArray(input)) input = input.join(',');
  if (input === null || input === undefined) return [];

  var out = {};
  String(input).split(',').forEach(function (part) {
    part = part.trim();
    if (!part) return;
    var m = part.match(/^(\d+)\s*-\s*(\d+)$/);
    if (m) {
      var a = parseInt(m[1], 10), b = parseInt(m[2], 10);
      if (a > b) { var t = a; a = b; b = t; }
      for (var n = a; n <= b; n++) if (n >= min && n <= max) out[n] = true;
    } else {
      var v = parseInt(part, 10);
      if (!isNaN(v) && v >= min && v <= max) out[v] = true;
    }
  });
  return Object.keys(out).map(Number).sort(function (x, y) { return x - y; });
}

/**
 * Formate un tableau de nombres en plages compactes : [10,20,230,...,240] → "10, 20, 230-240".
 * Les suites de 3 valeurs consécutives ou plus sont condensées en "a-b".
 */
function formatRanges(arr) {
  if (!Array.isArray(arr) || !arr.length) return '';
  var nums = arr.map(Number).filter(function (n) { return !isNaN(n); }).sort(function (x, y) { return x - y; });
  var u = [];
  for (var i = 0; i < nums.length; i++) if (!u.length || u[u.length - 1] !== nums[i]) u.push(nums[i]);

  var parts = [];
  var start = u[0], prev = u[0];
  function flush() {
    if (prev - start >= 2) parts.push(start + '-' + prev);
    else for (var k = start; k <= prev; k++) parts.push(String(k));
  }
  for (var j = 1; j < u.length; j++) {
    if (u[j] === prev + 1) { prev = u[j]; continue; }
    flush();
    start = u[j]; prev = u[j];
  }
  flush();
  return parts.join(', ');
}

module.exports = { parseRanges, formatRanges };
