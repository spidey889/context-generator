// Historical migration checks must exclude fields introduced by later migrations.
// Keep the old-schema comparisons complete rather than filtering to whatever SQL contains.
function beforePasteDiagnosis(schema) {
  const result = structuredClone(schema);
  delete result.insertion_blocked_reason;
  return result;
}
function withoutPasteEditorFields(schema) {
  const result = beforePasteDiagnosis(schema);
  for (const key of ["editor_match_count", "editor_match_peak", "editor_unmatched_count", "editor_hidden_count", "editor_aria_hidden_count",
    "editor_modal_count", "editor_owned_count", "editor_disabled_count", "editor_readonly_count", "editor_not_editable_count", "editor_ready_count",
    "editor_retained", "editor_insert_attempted", "editor_document_focused"]) delete result[key];
  return result;
}
module.exports = { withoutPasteEditorFields, beforePasteDiagnosis };
