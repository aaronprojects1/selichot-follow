# Audio corpus sources

## User-provided phone-to-phone calibration sample

- Local source: `WhatsApp Ptt 2026-09-06 at 13.04.09.ogg`
- SHA-256: `e4a68c1a80bd7e6bcb8ebe1be48bb27ce40866b422cd81828ed35bb7b29c9c92`
- Purpose: calibrated acoustic fingerprint for the supplied Bizochri recording after it was played from one phone and captured by a second phone.
- This recording is included in the development repository and is never deployed to Firebase Hosting. The web build contains a compact, non-reversible fingerprint and reviewed cue times.

## Adon HaSelichot — Ades Synagogue, Jerusalem (1982)

- Local source: `nli-adon-haselihot-ades-1982.ogg`
- SHA-256: `f87d4c3c5cf8fc021cd86d17adfadfbc7269b42e29cd3a36214f466471419b2e`
- Performance: Congregation of Ades Synagogue, Jerusalem
- Recorded by: Chana England, 1982
- Source institution: National Library of Israel, via Wikimedia Commons
- Source page: <https://commons.wikimedia.org/wiki/File:The_National_Library_of_Israel_-_Adon_HaSelihot_-_1765167_adon.ogg>
- License: Creative Commons Attribution-ShareAlike 3.0 Unported
- License URL: <https://creativecommons.org/licenses/by-sa/3.0/>

The source audio is retained only in the development corpus and is not deployed. The web build contains a quantized acoustic feature adaptation and verse timing cues. That derived reference and its attribution metadata are distributed under CC BY-SA 3.0.

## Held-out High Holiday negative recordings

These recordings are retained only to verify that Hebrew liturgical music with
different words does not create a Selichot reference lock. They are not included
in `web/`, and no fingerprints from them are used as positive training data. All
were donated by the National Library of Israel to Wikimedia Commons under CC
BY-SA 3.0 (with additional compatible licenses listed on each source page).

| Local file | SHA-256 | Source and attribution |
| --- | --- | --- |
| `negative/nli-el-nora-alila-baghdad-1958.ogg` | `b5446257382d551bf19710811a15c8fb7876d38775799a0c1187d3ee95edf889` | [El Nora Alila — Baghdad](https://commons.wikimedia.org/wiki/File:The_National_Library_of_Israel_-_El_Nora_Alila_-_Baghdad_version_-_1785181_HURI.ogg), Yaakov Huri and group; recorded by Edith Gerson-Kiwi, Jerusalem, 1958 |
| `negative/nli-el-nora-alila-greek-larissa-1970.ogg` | `42795618b12c53c75004ba7fcb6336e414998b0bdb908ca3a7e889a36b238c38` | [El Nora Alila — Greek/Larissa](https://commons.wikimedia.org/wiki/File:The_National_Library_of_Israel_-_El_Nora_Alila_-_Greek_version_-_1785182_larisa.ogg), Itzhak Meizan; recorded by Amnon Shiloah, 1970 |
| `negative/nli-avinu-malkeinu-huc-jerusalem-2004.ogg` | `a67edf7241fc39d2317ab6bc8e4ef6aa54978c199b79aaafaae1e941eb5c1127` | [Avinu Malkeinu](https://commons.wikimedia.org/wiki/File:The_National_Library_of_Israel_-_Avinu_Malkeinu_1785184_avinu.ogg), Jennifer Strauss-Klein and HUC-JIR Cantorial Choir, Jerusalem, 2004 |
| `negative/nli-kol-nidre-tangier-1960s.ogg` | `d21c5b62b493cee2f29f0e9d96c76f9664e828413623faa3f039343cff2252c0` | [Kol Nidre — Tangier](https://commons.wikimedia.org/wiki/File:The_National_Library_of_Israel_-_Kol_Nidre_-_1785178_KOLTANGIR.ogg), Chaim Cohen; recorded by Abraham Pinto, early 1960s |
