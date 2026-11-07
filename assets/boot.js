/* The data files are plain scripts (so that the page also works from file://). Each one calls
   __put(kind, ch, id, data) when it has loaded; XYZ holds the species structures of each chalcogen. */
var XYZ = {}, __cache = {}, __wait = {};
function __put(k, c, i, d) { var key = k + "/" + c + "/" + i; __cache[key] = d; (__wait[key] || []).forEach(function (f) { f(d); }); delete __wait[key]; }
