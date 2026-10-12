const assert = require("node:assert/strict");

// These samples only call a pure validator. Batch their SQL round trip while
// retaining a separate, labelled assertion for every input and expected result.
// Stateful RPC, role, clock and migration scenarios must remain sequential.
async function checkDiagnosticsSamples(db, samples) {
  const rows = (await db.query(`select public.is_valid_transfer_diagnostics(sample) as valid
    from jsonb_array_elements($1::jsonb) with ordinality as input(sample, position)
    order by position`, [JSON.stringify(samples.map(sample => sample.value))])).rows;
  assert.equal(rows.length, samples.length, "Every diagnostics sample must produce one result");
  for (const [index, sample] of samples.entries()) {
    assert.equal(rows[index].valid, sample.expected, sample.label);
  }
  return samples.length + 1;
}

module.exports = { checkDiagnosticsSamples };
