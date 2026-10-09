# StudyBuddy

Reads books (PDF), videos and notices from a private Telegram channel. No backend, no login.

## Build and install
1. Push this folder to `mrtuik/StudyBuddy` (main branch). Keep the repo **private** (it contains the signing keystore).
2. Secrets needed: TG_API_ID, TG_API_HASH, TG_BOT_TOKEN, CHANNEL_ID.
3. Actions > Build APK > download the `StudyBuddy-apk` artifact and install the APK.
4. Every build is signed with `keystore/studybuddy.p12` and has a higher version code, so new APKs install as updates over the old one.

The bot must be admin in the private channel (all permissions off) and the channel needs at least one post.

## Caption format
- `#book Title | Subject | Author` (PDF sent as file; optional cover photo as a reply)
- `#video Course | Subject | Chapter | Lesson | Order` (video sent as file)
- `#course Name | Description` (photo = course cover)
- `#notice Title | Details` (text message)

## V2: native PDF reader
Downloaded books open with Android's built-in `PdfRenderer` (a small Capacitor plugin in `native/android/NativePdfPlugin.java`, installed into the generated Android project by `scripts/patch-android.py`). Streaming (not downloaded) books still use pdf.js, and pdf.js is also the automatic fallback if a PDF cannot be opened natively.

## V3: profile redesign
The Profile screen is a profile card (banner, square avatar, name with badge, bio, link, Sync button), a "Continue" row of recently opened books/lessons, an activity grid and an apps list. Texts come from `src/store/profile.ts` (defaults there) so they can later be filled from Telegram.

## V4: YouTube lessons
A lesson can be a YouTube link instead of a Telegram video file. Send it as a normal text message (no file):
`#video Microbiology Course | Bacteriology | Introduction | Lesson 3 - Staining | 3 | https://youtu.be/XXXXXXXXXXX`
The order field can be left out (`... | Lesson 3 - Staining | https://youtu.be/XXX`). File lessons and YouTube lessons can be mixed in one course. YouTube lessons need internet and cannot be downloaded; progress and Continue Watching still work.

## V5: Admin tab (post from inside the app)
- **Notice** moved to the bell at the top right. The bottom bar now has **Admin** instead.
- **Login**: post a message in the channel (as yourself) like
  ```
  #id1
  Studybuddy
  tuik@123
  ```
  (id on line 2, password on line 3; add `#id2`, `#id3` ... for more logins). Edit or delete the message to change or remove a login. The app re-checks the message on Telegram every time Admin opens, so removed ids are logged out.
- **Posting**: Book / Video / YouTube / Course / Notice forms. Course, subject and chapter names are suggested from what is already in the channel, and the lesson order is filled automatically. The app writes the exact `#book ...` caption for you.
- **Posting bot**: make a second bot in @BotFather, add it to the channel as admin with only "Post messages", and paste its token in the Admin tab once. It is stored on the phone only, not in the APK.
- The login is a convenience gate. The real protection is that the posting token never ships inside the APK. Anyone who can read the channel can read the `#id` messages.
- Big files are loaded into phone memory while uploading; very large files (200 MB+) may fail, use the Telegram bot upload for those.

## V5.1: Admin > Manage (edit / delete old posts)
- Admin has two tabs: **Create** and **Manage**.
- **Manage > Courses**: tap a course to see subjects, chapters and lessons. Edit course (name, description, cover), rename or delete a subject or chapter, edit or delete a lesson (title, order, move to another subject or chapter). **+** buttons open the Create form with course / subject / chapter already filled in, so a new chapter is just "add a lesson with a new chapter name".
- **Manage > Books** (title, subject, author, change cover, delete) and **Manage > Notices** (edit, delete).
- Renaming a course, subject or chapter edits the caption of every lesson inside it (one edit per lesson, paced to stay under Telegram's limit).
- The posting bot now needs these admin permissions in the channel: Post messages, **Edit messages of others**, **Delete messages**.
- The sync now re-checks every known post (not just the last 200 messages), so edits and deletes reach all phones.

## V6.1: upgraded PDF reader
- **Roadmap** (map icon, or tap the chapter tab on the right edge): chapters listed as 1, 2, 3 … with page range, per-chapter progress, a "You are here" marker and expandable topics. Chapters come from the PDF's own index (bookmarks); if the PDF has none, the index page is parsed from its text (with a page-offset fix), and as a last resort the book is split into 25-page parts. The result is cached per book.
- **Floating reader UI**: top bar shows book + current chapter, bottom pill shows page / total and zoom %, round prev/next buttons, options sheet (night page, share, zoom, download, bookmarks).
- **Annotate** (pen icon): pen, highlighter, eraser, undo / redo, 6 colours. Notes are saved per page on the phone and scale with zoom. Works with both the native and pdf.js engines.
- V6.1: when the PDF has no index/bookmarks and no printed contents page, the whole book is scanned once for chapter opener pages ("Chapter N" headings, otherwise pages that start with a much larger title). The Contents screen is now a plain minimal list; the refresh icon re-scans the book.
- V6.2: online (not downloaded) books now read ranges with the same direct GetFile method the downloader uses (4 in parallel, with data-centre migration and retries) instead of `iterDownload`. A failed range request now shows an error with Retry instead of hanging, and the online watchdog is 90 s.
- V6.3: chapters are now found from "CHAPTER N" opener pages across the whole book (exact PDF pages, no offset). If only the printed index page is available, the printed->PDF page shift is worked out automatically from any opener found. Titles with stray spaces ("Morpho l ogy") are repaired using words from the book itself. Cache key bumped, so every book is re-scanned once.
- V6.4: **online PDFs open instantly the second time.** Every chunk read from Telegram for a PDF (now 1 MB each) is saved in IndexedDB (least-recently-used, capped at ~500 MB), so reopening and re-reading pages needs no network and works offline for the pages already read. The next 3 chunks are read ahead quietly. Videos are not cached. The chapter scan of an online book runs only when the Roadmap is opened (it reads the whole file once, then it is cached).
- V6.5: **warm open**: when a book's page opens, the app already connects, opens the PDF and loads the page you will resume on, so tapping Read is near-instant even the first time. Online range reads use 6 parallel requests.
- V6.6: **faster video start.** The lesson screen warms the video (connect + first 3 MB + tail) before Play is tapped; the first 3 chunks and the tail are cached in IndexedDB so replays start instantly; the service worker answers the first request after 1 MB (it used to wait for 4 MB); the next 3 MB are read ahead while playing; the next lesson is warmed while the current one plays.

## V6.9.4: YouTube playlist import (Admin > Playlist)
- Paste a playlist link, the app reads all its videos (also playlists with more than 100) and guesses **course, subject and chapters** from the titles:
  1. "Unit 2" / "Chapter 3" / "Module 4" in the titles (videos without a number stay in the previous chapter),
  2. titles that start the same way ("Bacterial growth | Part 1", "... Part 2"),
  3. otherwise blocks of 5 videos (Auto / Every N / One chapter switch).
- A preview lets you rename chapters, edit lesson titles, remove videos, and Split / Join chapters before anything is posted. Videos already in the channel are skipped.
- Then one `#video Course | Subject | Chapter | Title | Order | https://youtu.be/ID` message is posted per video (about 1 per second). If it stops half way, tap Post again and it continues with the rest.
- If the playlist cannot be read (private, YouTube changed its page), use **Paste links** (one link per line, title optional).

## V6.9.5: `#playlist` post (just paste the playlist link in the channel)
Send ONE text message in the channel:
`#playlist DMLT 1ST YR | MICROBIOLOGY | https://youtube.com/playlist?list=PL...`
- Course and subject can be left out (`#playlist https://youtube.com/playlist?list=PL...`): they are guessed from the playlist title and the names already in the channel. With only one name it is taken as the course.
- Optional extra part: a number (`| 6` = 6 videos per chapter) or `| one` (everything in one chapter). Default is automatic: "Unit/Chapter N" in titles, then titles that start the same, then blocks of 5.
- Every phone reads the playlist itself on Sync and keeps the list (re-checked every 6 hours, so videos added to the playlist later appear by themselves). Videos already posted as `#video` are skipped.
- Playlist lessons have no message of their own: to change or remove them, edit or delete the `#playlist` message. Admin > Manage shows them as "playlist" and does not edit them.
- Admin > Playlist has a button "Post only the playlist link" that posts this message for you.

- V6.9.6: a third text part sets the chapter yourself: `#playlist Course | Subject | Chapter | link`. All videos of the playlist go into that chapter (new lessons continue after the ones already there). Without it the chapters are guessed.
- V6.9.7: playlist reading no longer depends on one page layout. It tries, in order: the playlist page (old and new layout), YouTube's browse API, the "up next" API, and the public RSS feed (newest 15 videos only). If all fail, the error lists what each step returned.
- V6.9.8: **one playlist in several chapters**: add a range part, e.g. `#playlist DMLT 1ST YR | MICROBIOLOGY | General | 1-10 | link` and `... | Staining | 11-20 | link` (`21-` = from video 21 to the end). A video is shown only once, so a second post with the same link and no range gets nothing. Player: chapter list shows thumbnails with the full wrapped title; YouTube's own fullscreen button is off and the app's fullscreen button (top left) rotates the phone to landscape.
- V6.9.9: the same playlist can be posted into several chapters without a range (each `#playlist` post is independent). A video is only skipped when that chapter already has it. The range part (`1-10`) is optional and only for splitting one playlist.
- V6.9.10: Admin > Playlist shows every `#playlist` post with how many videos were read and shown, and a "Read again" button that forces a fresh download of all playlists (and shows the error if one fails).

## Gemini API key (Buddy)
The key is not typed in the app. Post it in the private channel: `#key AIzaSy...` (newest `#key` post wins; delete the post to remove the key). The app picks it up on the next sync.
