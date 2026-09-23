// Runs once after the suite: a DS_IMPACT=map run folds its per-test coverage
// records into .impact/map.json (see impact-map.js).
module.exports = async () => {
  if (process.env.DS_IMPACT === 'map') require('./impact-map').merge();
};
