# Saving progress to an account (cloud sync)

Without sync, each reader's progress lives only in their browser. It is
lost if they clear site data, and it doesn't follow them to another
device. Sync is optional. When it's on, readers can sign in and their
progress is saved to their account too.

**Only progress is synced:** memory levels, times seen and missed,
review dates, days practised and the last five results. The questions
stay in `questions.json` and are never sent to the database.

The quiz works the same with or without sync. Signing in is optional
for readers. The Download / Load / Reset progress buttons still work
either way.

## Files

```
js/sync/
  sync-config.js          which database to use, and its settings  <- edit
  progress-merge.js       combines two copies of progress (no database code)
  cloud-sync.js           the sign-in bar, when to save, merging (no database code)
  providers/
    firebase.js                 adapter: Google sign-in + Firestore
    firebase-firestore.rules    security rules to paste into Firebase
    example-in-browser.js       smallest working adapter; copy it for a new DB
css/cloud-sync.css        looks of the sign-in bar
```

Only `providers/<name>.js` knows about a particular database. Everything
else talks to it through five functions (see "Writing an adapter").

## Turn sync off

In `js/sync/sync-config.js` set:

```js
provider: "none",
```

The sign-in bar disappears and nothing is loaded from any database.
Readers' progress already in their browsers is untouched.

To remove sync completely, also delete the `js/sync/` folder,
`css/cloud-sync.css`, the three `js/sync/...` script lines and the
`cloud-sync.css` line in `index.html`, and the empty
`<div id="cloud-sync-bar">`. Nothing else refers to them. The quiz only
sends events (`recallquiz:book-opened`, `recallquiz:progress-saved`,
`recallquiz:session-finished`) that nobody needs to listen to.

## Set up Firebase (the included adapter)

One Firebase project can serve every book site on the same GitHub Pages
domain. Each book is saved under its own `id` from `questions.json`.

1. In the [Firebase console](https://console.firebase.google.com),
   create a project (the free Spark plan is enough). Google Analytics is
   not needed.
2. **Build > Authentication > Get started > Sign-in method > Google >
   Enable.** Choose a support email and save.
3. **Authentication > Settings > Authorized domains > Add domain:** your
   GitHub Pages domain, for example `eckko.github.io`. (`localhost` is
   there already, for testing.)
4. **Build > Firestore Database > Create database.** Pick a location near
   your readers (for example `europe-west2`, London). Start in
   production mode.
5. **Firestore Database > Rules:** replace everything with the contents
   of `providers/firebase-firestore.rules` and press **Publish**. Each
   reader can then read and write only their own progress.
6. **Project settings (gear icon) > Your apps > Web app (`</>`)**:
   register an app and copy the values from its `firebaseConfig` into
   the `firebase` block of `sync-config.js`. They are not secrets.
   `measurementId` (Analytics) is not needed. `sdkVersion` is the
   number in the console's script URLs (for example `12.19.0`).
7. Set `provider: "firebase"`, publish the site, open it and press
   **Sign in with Google**.

Sign-in only works on the published site or `http://localhost`. Opened
straight from a folder (`file://`), the bar explains that progress is
kept in the browser only.

### What is stored

One document per reader per book:

```
users/{Firebase user id}/books/{book id}
  progress:  the progress object as JSON text (see ai-context/data-formats.md)
  updatedAt: server time of the last save
```

A book of about 1,500 questions with all of them practised is roughly
200 KB. The free plan's limits (1 GiB stored, 50,000 reads and 20,000
writes a day) leave a lot of room. Each sync is one read and at most one
write. A sync happens when the page opens, about 20 seconds after the
last answer, at the end of a session, and when the page is hidden.
Firestore documents can hold up to 1 MiB, which is about 7,000
practised questions per book.

## How syncing behaves

- **Merging.** Each sync reads the account copy, combines it with this
  browser's copy, and saves the result in both places. For each
  question, the most recently answered record wins (its memory level and
  next review date are what matter). Days practised and recent results
  are combined. So practising on a phone and a laptop on the same day
  keeps the latest state of every question. If the same question was
  answered on both, only the newer record's seen/missed counts are kept.
- **Reset.** Reset stamps the progress with the time (`resetAt`). Once
  synced, everything older is dropped on every device, so a reset is
  not undone by another device's older copy.
- **Load (backup file).** Loading is stamped the same way, so the
  backup replaces the account copy (it is not mixed with it). Answers
  given on another device after the Load are still added.
- **Sign out.** Last changes are saved, then this book's progress is
  removed from this browser so the next person on the device starts
  fresh. It is still in the account.
- **Shared devices.** If progress in the browser belongs to a different
  account (someone else signed in here before), it is ignored rather
  than mixed into yours.
- **Offline or database down.** Practice carries on and saves in the
  browser. The bar shows "Could not reach your account" with Try again
  and Sign out buttons. A database call that takes longer than 15
  seconds counts as failed. The next successful sync merges everything.
- **Two tabs open.** Every save in one tab is picked up by the other
  tabs, so they never overwrite each other's answers.
- **Sign-in pop-up.** Sign-in opens a Google pop-up. If the browser
  blocks pop-ups, it falls back to a full-page redirect. On browsers
  that block third-party storage (Safari, Firefox, some Chrome
  settings), that redirect may fail because the site is on
  `github.io` and Firebase's sign-in page is on `firebaseapp.com`.
  Readers should allow pop-ups for the site. If the redirect is ever
  needed, see Firebase's guide "Best practices for using
  signInWithRedirect on browsers that block third-party storage".

## Switch to a different database

1. Copy `providers/example-in-browser.js` to `providers/<name>.js` (a
   lowercase name such as `supabase`). Replace its inside with calls to
   the new database. Keep the five functions and the
   `registerProvider("<name>", ...)` line.
2. In `sync-config.js` set `provider: "<name>"` and add a `<name>: { ... }`
   block with that database's settings. It is passed to your `start`.
3. Run `python3 tests/run_tests.py`. The sync tests use the example
   adapter, so they check the shared parts. Test your adapter by
   signing in on `http://localhost`.

No other file changes. `index.html` does not need a new script tag,
because `cloud-sync.js` loads `providers/<name>.js` by itself.

Readers' progress does not move between databases automatically. It is
still in their browsers, so the first sign-in to the new database
uploads it (merging as usual). Readers who cleared their browser can
use Download on a device that still has it, then Load.

### Writing an adapter

An adapter registers an object with these members. Every function
returns a Promise.

```js
quiz.cloudSync.registerProvider("name", {
  label: "Google",   // shown as "Sign in with Google"

  // Connect using the settings block from sync-config.js. Call
  // onUserChanged(user or null) now and whenever sign-in changes.
  // user = { id: "stable id", name: "Shown name", email: "" }
  start(settings, onUserChanged) {},

  signIn() {},        // show the sign-in flow; then call onUserChanged
  signOut() {},       // then call onUserChanged(null)

  // The saved progress object for this reader and book, or null if
  // there is none yet.
  readProgress(userId, bookId) {},

  // Save the whole progress object, replacing what was there.
  writeProgress(userId, bookId, progress) {},
});
```

Rules for any adapter:

- Store the progress object as given (JSON text is simplest). Don't
  change its shape; merging happens in `progress-merge.js`.
- Make sure only the signed-in reader can read or write their own
  progress. This must be enforced by the database (security rules,
  row-level security), not by the page.
- Load the database's library only inside `start` (for example with
  `import()` from a CDN, as `firebase.js` does), so the quiz stays fast
  and still works when sync is off.

Examples of what could be plugged in: Supabase (Postgres plus row-level
security, also with Google sign-in), Appwrite, PocketBase, or your own
small server.
