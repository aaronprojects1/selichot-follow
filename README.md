# Selichot Follow

A Hebrew/English companion for following Sephardic Selichot, with an installable website and a native Android app.

**Live website:** https://selichot-web.web.app/

## Project files

- [`SelichotFollow/web/`](SelichotFollow/web/): website, speech tracking, offline service text, and browser-core tests.
- [`SelichotFollow/app/`](SelichotFollow/app/): native Android application and unit tests.
- [`SelichotFollow/SelichotFollow.apk`](SelichotFollow/SelichotFollow.apk): existing Android install package.
- [`tools/`](tools/): audio analysis and browser verification scripts.
- [`corpus/`](corpus/): reference recordings and source attribution.
- Root audio files: supplied development recordings used by the analysis tools.

See the [project documentation](SelichotFollow/README.md) for setup, testing, deployment, and tracking limitations, and [audio training notes](SelichotFollow/AUDIO_TRAINING.md) for reference coverage.

## Run the website locally

```sh
python -m http.server 8765 --directory SelichotFollow/web
```

Open http://localhost:8765. Run the web tests with:

```sh
node --test SelichotFollow/web/tests/*.test.mjs
```

## Deploy

With access to the Firebase project:

```sh
cd SelichotFollow
firebase deploy --only hosting --project selichot-web
```

Source recordings are development inputs; Firebase deploys only the `web/` directory. Audio and text attribution is retained in the project and corpus documentation. Local caches, generated build directories, credentials, and debug logs are excluded from version control.
