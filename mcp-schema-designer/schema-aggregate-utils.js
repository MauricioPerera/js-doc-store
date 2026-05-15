// Helpers for the schema_aggregate MCP tool.

const VALID_OPS = ['$count', '$sum', '$avg', '$min', '$max', '$push', '$first', '$last'];
const VALID_OPS_SET = new Set(VALID_OPS);

const ACCUMULATOR_HELP =
  'Use a MongoDB-style operator object, e.g. ' +
  '{ totalViews: { $sum: "views" }, avgPrice: { $avg: "price" }, count: { $count: 1 } }. ' +
  'Supported operators: ' + VALID_OPS.join(', ') + '.';

function validateAccumulators(accumulators) {
  if (!accumulators || typeof accumulators !== 'object') {
    throw new Error(
      'group stage requires an "accumulators" object. ' + ACCUMULATOR_HELP
    );
  }
  for (const [name, def] of Object.entries(accumulators)) {
    if (!def || typeof def !== 'object' || Array.isArray(def)) {
      throw new Error(
        `accumulator "${name}" must be an object with one operator key. ` + ACCUMULATOR_HELP
      );
    }
    const keys = Object.keys(def);
    if (keys.length === 0) {
      throw new Error(
        `accumulator "${name}" has no operator. ` + ACCUMULATOR_HELP
      );
    }
    const hasValidOp = keys.some(k => VALID_OPS_SET.has(k));
    if (!hasValidOp) {
      throw new Error(
        `accumulator "${name}" uses unrecognized shape (${JSON.stringify(def)}). ` + ACCUMULATOR_HELP
      );
    }
  }
  return accumulators;
}

module.exports = { validateAccumulators, VALID_OPS, ACCUMULATOR_HELP };
