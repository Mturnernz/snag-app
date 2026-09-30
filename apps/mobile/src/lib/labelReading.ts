/**
 * Whether the app reads a photographed label, and looks the model up.
 *
 * **Off for v1.** Both call Google's Gemini on the operator's key, and on the
 * day before launch that key's prepaid credits ran out: every read came back
 * `402`, which the app worded as a generic failure with a *Try again* that
 * could not work and spent one of the household's fifty daily reads each time
 * it was pressed. A feature that fails in front of somebody on their first day
 * costs more trust than it earns, so the walkthrough asks for the details by
 * hand — the boxes were always there — and the photograph of the plate is kept
 * as the record it always was.
 *
 * Off, nothing calls `read-label` or `lookup-product`: the walkthrough takes
 * the photo and asks for the make and model; the thing's page shows neither the
 * *Read from the label* card nor *What the maker says*; and the House tab counts
 * no labels to check.
 *
 * Set `EXPO_PUBLIC_LABEL_READING=on` in the build's environment (Netlify, for
 * the web build) and redeploy to bring it back — after the Gemini key has
 * credit and auto-reload, and one real plate has been read. Read on each call
 * rather than once, so a test can turn it on and off; Expo inlines the value at
 * build time either way.
 */
export function labelReadingEnabled(): boolean {
  return process.env.EXPO_PUBLIC_LABEL_READING === 'on';
}
