/**
 * The legal screens, rendered in-app.
 *
 * These used to be a privacy policy and terms of service for a hosted product
 * with accounts, payments and a support inbox. None of that exists here, and
 * keeping the text would have been the dishonest kind of boilerplate: a page
 * promising to look after data that never leaves the machine, from a company
 * that is not a party to anything.
 *
 * What replaces it is the truth, which is shorter: there is no server, and the
 * software is MIT-licensed.
 */

export interface LegalSection {
  heading: string
  body: string
}

export interface LegalDocument {
  title: string
  updated: string
  intro: string
  sections: LegalSection[]
}

export const LEGAL_DOCUMENTS: Record<string, LegalDocument> = {
  privacy: {
    title: 'Privacy',
    updated: '2026',
    intro:
      'ClawMuse has no backend. There is no account, no telemetry, and no server operated by anyone that this app reports to.',
    sections: [
      {
        heading: 'What stays on your machine',
        body: 'Your conversations, agents and their memory, work files, and provider keys are stored under ~/.openclaw-clawmuse on this computer. ClawMuse connects to its gateway only through 127.0.0.1.',
      },
      {
        heading: 'What does leave your machine',
        body: 'Three things. Messages you send — and the prompts the built-in Feed, Ideas and check-ins run — go to the model provider you chose, under your own API key and their terms, unless you picked a model that runs locally. When a bot browses the web or calls a connector, it reaches that site or service the same way your browser would. And the Feed looks up headlines on Bing News (Google News if Bing has none), using short search terms written from your goals, and shows article pictures from Bing; turn Daily feed off in Settings → Notifications to stop it.',
      },
      {
        heading: 'Crash reports and analytics',
        body: 'There are none. No usage data is collected, and there is no mechanism in the app to collect any.',
      },
      {
        heading: 'Deleting your data',
        body: 'Settings → Data controls → Remove ClawMuse stops the agent service, deletes everything the app stored (~/.openclaw-clawmuse, its app data, logs and login item) and removes the app itself. There is no ClawMuse account to close.',
      },
    ],
  },
  terms: {
    title: 'Terms',
    updated: '2026',
    intro:
      'ClawMuse is local desktop software. Using it does not create a ClawMuse account because there is no ClawMuse cloud service.',
    sections: [
      {
        heading: 'The licence',
        body: 'MIT. You may use, copy, modify and distribute this software, including commercially, provided the copyright notice and licence text are kept. The full text ships with the source.',
      },
      {
        heading: 'No warranty',
        body: 'The software is provided "as is", without warranty of any kind. It runs agents that take real actions on your computer — writing files, running commands, browsing the web — and you are responsible for what you ask it to do and for the boundaries you set.',
      },
      {
        heading: 'Your model provider',
        body: 'Whatever you send to a model provider is governed by your agreement with them, not by this software. The same applies to any service a connector reaches.',
      },
      {
        heading: 'Contributions',
        body: 'Contributions are welcome under the same licence.',
      },
    ],
  },
}
