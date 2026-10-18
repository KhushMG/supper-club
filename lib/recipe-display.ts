// Presentation only: retain source quantities and ingredient/preparation words.
export function ingredientDisplayText(value: string) {
  let text = value.replace(/^\s*\|+|\|+\s*$/g, "").replace(/\s+/g, " ").trim();
  // Some publishers wrap already-parenthesized notes a second time.
  while (/\(\s*\([^()]*\)\s*\)/.test(text)) {
    text = text.replace(/\(\s*\(([^()]*)\)\s*\)/g, "($1)");
  }
  return text
    .replace(/\s*\(\s*,\s*([^()]+?)\s*\)/g, ", $1")
    .replace(/\(\s+/g, "(")
    .replace(/\s+\)/g, ")")
    .replace(/\s+([,;])/g, "$1")
    .replace(/\(\s*\)/g, "")
    .replace(/\s+/g, " ")
    .trim();
}
