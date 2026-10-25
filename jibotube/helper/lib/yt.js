'use strict';

// InnerTube-backed YouTube client. Everything runs on the robot: search,
// metadata, captions, thumbnails and the adaptive stream URLs.
const innertube = require('./innertube');
function search(query, limit) {
  return innertube.search(query, limit);
}
function video(id) {
  return innertube.video(id);
}
function captions(url) {
  return innertube.captions(url);
}
function thumbPath(id) {
  return innertube.thumbPath(id);
}

// Channel uploads are found through a channel-name search; InnerTube's browse
// tab would need the channel params and is not required for the home row.
function channelVideos(channel, limit) {
  if (!channel) return Promise.resolve([]);
  return innertube.search(String(channel) + ' latest videos', limit || 8);
}
module.exports = {
  search,
  video,
  captions,
  channelVideos,
  thumbPath
};
