/**
 * Whether a job offers *Ask SnagHQ about this*.
 *
 * **Off for v1**, the same way label reading is (`lib/labelReading.ts`): the
 * staff portal has nobody answering it yet, and a button that sends a question
 * into a queue nobody reads is a promise the app cannot keep. Off, the job page
 * shows neither the button nor `SupportCard`, opens no `AskSnagHQSheet`, and
 * never reads `getSupportRequestForSnag`.
 *
 * Set `EXPO_PUBLIC_ASK_SNAGHQ=on` in the build's environment and redeploy to
 * bring it back. Read on each call so a test can turn it on and off.
 */
export function askSnagHQEnabled(): boolean {
  return process.env.EXPO_PUBLIC_ASK_SNAGHQ === 'on';
}
