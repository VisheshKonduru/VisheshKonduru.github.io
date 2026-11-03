# VisheshKonduru.github.io

Personal portfolio. Plain HTML and CSS, no build step needed to serve it.

## Edit

Text lives in `tools/build.py`. Change it there, then run:

```bash
python tools/build.py
```

Do not hand-edit the generated `index.html`, `journey.html`, `about.html` or `projects/*.html`; the next build overwrites them.

## Add photos

- Profile photo: save it as `assets/img/me.jpg` (portrait, about 4:5). The page shows a placeholder until it exists.
- Everything else: put the file under `assets/img/<project>/`, then in `tools/build.py` replace the matching `todo("...")` with `img("assets/img/...", "caption")`.
- Keep images under about 500 KB (resize to 1800 px wide, JPEG quality ~85).

## Publish on GitHub Pages

1. Create a public repo named exactly `VisheshKonduru.github.io`.
2. Push this folder to it.
3. Repo Settings > Pages > Source: deploy from branch `main`, folder `/ (root)`.
4. The site goes live at https://visheshkonduru.github.io

`docs/IQP_Report.pdf` is about 70 MB. GitHub accepts files up to 100 MB but warns above 50 MB.
