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

GitHub Actions tests every pull request targeting `main`. Every push or merge to `main` automatically tests and deploys the website to Firebase Hosting. A failed test prevents deployment. You can also run **Test and deploy website** manually from the repository's Actions tab.

Anyone can propose changes by forking this public repository and opening a pull request. Production deployment happens after a maintainer merges the change into `main`; pull requests do not receive deployment credentials.

Deployment uses Google Workload Identity Federation and a dedicated Hosting service account, with access restricted to this repository's `main` branch for push and manual workflow events. No service-account key or Firebase login token is stored in this repository.

With access to the Firebase project:

```sh
cd SelichotFollow
firebase deploy --only hosting --project selichot-web
```

Source recordings are development inputs; Firebase deploys only the `web/` directory. Audio and text attribution is retained in the project and corpus documentation. Local caches, generated build directories, credentials, and debug logs are excluded from version control.
