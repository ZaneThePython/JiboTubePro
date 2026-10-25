'use strict';

function merge(segments, duration) {
  const list = segments.map(segment => ({
    start: Math.max(0, Number(segment.segment[0]) || 0),
    end: Math.min(duration || Infinity, Number(segment.segment[1]) || 0),
    category: segment.category || 'sponsor'
  })).filter(segment => segment.end > segment.start + 0.25).sort((a, b) => a.start - b.start);
  const merged = [];
  list.forEach(segment => {
    const last = merged[merged.length - 1];
    if (last && segment.start <= last.end + 0.5) {
      last.end = Math.max(last.end, segment.end);
      if (last.categories.indexOf(segment.category) < 0) last.categories.push(segment.category);
    } else {
      merged.push({
        start: segment.start,
        end: segment.end,
        categories: [segment.category]
      });
    }
  });
  return merged;
}
module.exports = {
  merge: merge
};
