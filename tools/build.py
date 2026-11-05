import re
"""Builds the static pages from the content below.

Run:  python tools/build.py
Output is plain HTML in the repo root and projects/. GitHub Pages serves it as is.
Edit text here, not in the generated .html files, or your edits will be overwritten.
"""
import hashlib
import json
import os
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent

EMAIL = "vishesh-konduru@outlook.com"
LINKEDIN = "https://www.linkedin.com/in/visheshkonduru"
GITHUB = "https://github.com/VisheshKonduru"
RESUME = "docs/Vishesh_Konduru_Resume.pdf"

NAV = [("index.html", "Work"), ("activities.html", "Activities"), ("about.html", "About")]


def page(title, body, current, depth=0, description=""):
    up = "../" * depth
    nav = "".join(
        f'<a href="{up}{href}"{" aria-current=page" if href == current else ""}>{label}</a>'
        for href, label in NAV
    )
    nav += f'<a href="{up}{RESUME}">Resume</a>'
    desc = description or "Vishesh Konduru, robotics engineering student at WPI."
    return f"""<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>{title}</title>
<meta name="description" content="{desc}">
<link rel="preconnect" href="https://fonts.googleapis.com">
<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
<link href="https://fonts.googleapis.com/css2?family=Geist:wght@400;500;600&display=swap" rel="stylesheet">
<link rel="stylesheet" href="{up}assets/css/site.css">
</head>
<body>
<a class="skip" href="#main">Skip to content</a>
<header class="site-head">
  <div class="edge head-inner">
    <a class="site-name" href="{up}index.html">Vishesh Konduru</a>
    <nav class="site-nav">{nav}</nav>
  </div>
</header>
<main id="main">
{body}
</main>
<p class="wip">Work in progress</p>
<footer class="site-foot">
  <div class="wrap">
    <span>Vishesh Konduru</span>
    <span><a href="mailto:{EMAIL}">{EMAIL}</a> &nbsp;·&nbsp; <a href="{LINKEDIN}">LinkedIn</a> &nbsp;·&nbsp; <a href="{GITHUB}">GitHub</a></span>
  </div>
</footer>
<script src="{up}assets/js/lite.js"></script>
<script>
(function(){{var hero=document.querySelector('.hero');if(!hero)return;var v=hero.querySelector('video'),done=false;
function go(){{if(!done){{done=true;hero.classList.add('go');}}}}
if(!v){{go();return;}}
function tick(){{if(done)return;if(v.currentTime>=0.45)go();else requestAnimationFrame(tick);}}
v.addEventListener('playing',tick);if(!v.paused)tick();
setTimeout(go,2500);}})();
(function(){{var h=document.querySelector('.site-head'),hero=document.querySelector('.hero');
if(!h||!hero)return;function f(){{h.classList.toggle('solid',hero.getBoundingClientRect().bottom<=h.offsetHeight);}}
f();addEventListener('scroll',f,{{passive:true}});addEventListener('resize',f);}})();
(function(){{if(!('IntersectionObserver' in window))return;
var still=matchMedia('(prefers-reduced-motion: reduce)').matches;
if(!still){{var els=document.querySelectorAll('main > section .wrap > *, .article > *, .stop, .entry');
var ro=new IntersectionObserver(function(es){{es.forEach(function(e){{if(e.isIntersecting){{e.target.classList.add('in');ro.unobserve(e.target);}}}});}},{{rootMargin:'0px 0px -8% 0px'}});
els.forEach(function(el){{if(el.getBoundingClientRect().top>innerHeight){{el.classList.add('rv');ro.observe(el);}}}});}}
var vo=new IntersectionObserver(function(es){{es.forEach(function(e){{var v=e.target;if(e.isIntersecting){{if(!still||v.closest('.hero')){{var p=v.play();if(p&&p.catch)p.catch(function(){{}});}}}}else v.pause();}});}},{{rootMargin:'200px'}});
document.querySelectorAll('video[autoplay]').forEach(function(v){{if(still&&!v.closest('.hero')){{v.removeAttribute('autoplay');v.pause();v.controls=true;}}vo.observe(v);}});
document.querySelectorAll('.yt').forEach(function(b){{b.addEventListener('click',function(){{var f=document.createElement('iframe');f.className='short';f.src='https://www.youtube-nocookie.com/embed/'+b.dataset.id+'?autoplay=1';f.title=b.dataset.title;f.allow='autoplay; encrypted-media; picture-in-picture';f.allowFullscreen=true;b.replaceWith(f);f.focus();}});}});
var toc=document.querySelectorAll('.toc a');if(!toc.length)return;var map={{}};toc.forEach(function(a){{map[a.getAttribute('href').slice(1)]=a;}});
var so=new IntersectionObserver(function(es){{es.forEach(function(e){{if(e.isIntersecting){{toc.forEach(function(a){{a.removeAttribute('aria-current');}});map[e.target.id].setAttribute('aria-current','true');}}}});}},{{rootMargin:'0px 0px -70% 0px'}});
document.querySelectorAll('.toc-m a').forEach(function(a){{a.addEventListener('click',function(){{a.closest('details').open=false;}});}});
document.querySelectorAll('.article h2[id]').forEach(function(h){{so.observe(h);}});}})();
</script>
</body>
</html>
"""


def img(src, caption="", cls="", depth=1, alt=None):
    up = "../" * depth
    cap = f"<figcaption>{caption}</figcaption>" if caption else ""
    return f'<figure class="figure {cls}"><img src="{up}{src}" alt="{alt or caption}" loading="lazy">{cap}</figure>'


def todo(text, cls=""):
    return f'<figure class="figure {cls}"><div class="todo">{text}</div></figure>'


import sys
sys.path.insert(0, str(Path(__file__).resolve().parent))
from projects_content import PROJECTS, IMPORTMAP  # noqa: E402


def honors_block(p):
    hs = p.get("honors") or []
    if not hs:
        return ""
    return '<ul class="honors">' + "".join(f"<li>{x}</li>" for x in hs) + "</ul>"


def honors_card(p):
    import re
    hs = p.get("honors") or []
    if not hs:
        return ""
    return '<ul class="honors honors-card">' + "".join(f"<li>{re.sub(r'<[^>]+>', '', x)}</li>" for x in hs) + "</ul>"


def _year(p):
    import re
    m = re.search(r"20\d\d(?: to (?:20\d\d|now))?", p["meta"])
    return m.group(0).replace(" to ", "&ndash;") if m else ""


def _sections(body):
    import re
    html = "".join(body)
    toc = []

    def sub(m):
        text = m.group(1)
        sid = re.sub(r"[^a-z0-9]+", "-", re.sub(r"<[^>]+>", "", text).lower()).strip("-")
        toc.append((sid, text))
        return f'<h2 id="{sid}">{text}</h2>'
    html = re.sub(r"<h2>(.*?)</h2>", sub, html)
    return html, toc


def project_page(p, prev, nxt):
    links = ""
    if p["links"]:
        items = "".join(
            f'<a href="{l[1]}" class="{l[2] if len(l) > 2 else ""}">{l[0]}</a>' for l in p["links"]
        )
        links = f'<div class="links top-links">{items}</div>'
    html, toc = _sections(p["body"])
    toc_html = toc_m = ""
    if toc:
        toc_m = '<details class="toc-m"><summary>On this page</summary><ol>' + "".join(
            f'<li><a href="#{sid}">{t}</a></li>' for sid, t in toc) + "</ol></details>"
        toc_html = '<nav class="toc" aria-label="Sections"><p>On this page</p><ol>' + "".join(
            f'<li><a href="#{sid}">{t}</a></li>' for sid, t in toc) + "</ol></nav>"
    tags = f'<p class="tagline">{", ".join(p["tags"])}</p>' if p.get("tags") else ""
    body = f"""
<article class="wrap chapter">
  <header class="chapter-head">
    <p class="crumb"><a href="../index.html">Work</a> / {p["title"]}</p>
    <h1>{p["title"]}</h1>
    {honors_block(p)}
    <p class="head-meta">{p["meta"]}{f' <span class="head-year">{_year(p)}</span>' if _year(p) and not re.search(r"(19|20)\d\d", p["meta"]) else ""}</p>
    {f'<p class="head-skills"><span>Skills</span> {", ".join(p["tags"])}</p>' if p.get("tags") else ""}
    {links}
  </header>
  {p.get("demo", "")}
  <div class="chapter-body">
    <aside class="toc-col">{toc_html}</aside>
    <div class="article">
    {toc_m}
    {html}
    </div>
  </div>
</article>
<section><div class="wrap pager">
  <a href="{prev["slug"]}.html"><span>Previous</span>&larr; {prev["title"]}</a>
  <a class="back" href="../index.html">Back to Work</a>
  <a href="{nxt["slug"]}.html"><span>Next</span>{nxt["title"]} &rarr;</a>
</div></section>
"""
    return page(f'{p["short"]} · Vishesh Konduru', body, "index.html", depth=1, description=p["blurb"])


def index_page():
    items = []
    for p in PROJECTS:
        thumb = (f'<img class="entry-img" src="{p["thumb"]}" alt="" loading="lazy">' if p["thumb"] else "")
        href = f'projects/{p["slug"]}.html'
        live = f'<p class="try"><a href="{href}#live-demo">Try it live</a></p>' if p.get("demo") else ""
        # The title link stretches over the whole entry; "Try it live" sits above it.
        items.append(f"""<div class="entry{" no-img" if not thumb else ""}">
  <div class="entry-media">{thumb}</div>
  <div class="entry-text">
    <h3><a class="entry-link" href="{href}">{p["title"]}</a></h3>
    {honors_card(p)}
    <p>{p["blurb"]}</p>
    <p class="entry-skills"><span>Skills</span> {", ".join(p["tags"])}</p>
    {live}
  </div>
</div>""")
    body = f"""
<section class="hero">
  <video autoplay muted loop playsinline preload="auto" poster="assets/video/hero_poster.jpg"><source src="assets/video/hero_av1.mp4" type="video/mp4; codecs=av01.0.08M.08"><source src="assets/video/hero.mp4" type="video/mp4"></video>
  <div class="hero-shade"></div>
  <div class="edge hero-body">
    <div class="hero-lockup">
    <h1 class="hero-name">Vishesh Konduru</h1>
    <div class="hero-block">
      <div><span>Robotics Engineering, CS Minor, WPI</span><span>BS May 2027 &middot; MS December 2027</span></div>
      <div><span>Software Engineer</span><span>Cavall Labs</span></div>
    </div>
    <div class="hero-links"><a href="mailto:{EMAIL}">Email</a><a href="{LINKEDIN}">LinkedIn</a><a href="{GITHUB}">GitHub</a><a href="{RESUME}">Resume</a></div>
    <a class="hero-live" href="#projects">See my projects run live in your browser</a>
    </div>
  </div>
</section>
<section id="projects">
  <div class="wrap">
    <div class="section-head"><h2>Projects</h2></div>
    <div class="index">{"".join(items)}</div>
  </div>
</section>


<section>
  <div class="wrap">
    <div class="section-head"><h2>Experience</h2></div>
    <div class="rows">
      <div class="row"><span class="when">Mar 2026 to now</span><div><strong>Software Engineer, Cavall Labs (CMU VentureBridge)</strong><p>Heimdall, the agent tooling around it, and a browser molecule sketcher.</p></div></div>
      <div class="row"><span class="when">Feb 2024 to May 2026</span><div><strong>Robotics Outreach Assistant, WPI</strong><p>Data work for Admissions and robotics outreach events.</p></div></div>
      <div class="row"><span class="when">Apr 2023 to now</span><div><strong>WPI VEX U Robotics</strong><p>Secretary, marketing chair, build lead, driver and programmer.</p></div></div>
    </div>
  </div>
</section>
"""
    return page("Vishesh Konduru", body, "index.html")


from activities_content import ACTIVITIES  # noqa: E402

JOURNEY_REDIRECT = """<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="utf-8">
<title>Activities · Vishesh Konduru</title>
<meta name="robots" content="noindex">
<link rel="canonical" href="activities.html">
<script>location.replace('activities.html' + location.hash);</script>
<meta http-equiv="refresh" content="0; url=activities.html">
</head>
<body>
<p>This page moved to <a href="activities.html">Activities</a>.</p>
</body>
</html>
"""


def _ratio(src):
    from PIL import Image
    try:
        w, h = Image.open(ROOT / src).size
        return w / h
    except Exception:
        return 4 / 3


def _media(m):
    kind, src, cap = m
    if kind == "img":
        return img(src, cap, depth=0)
    if kind == "video":
        return (f'<figure class="figure"><video src="{src}" controls muted loop playsinline preload="metadata"></video>'
                f'<figcaption>{cap}</figcaption></figure>')
    if kind == "yt":
        return (f'<figure class="figure"><button class="yt short" type="button" data-id="{src}" data-title="{cap}" '
                f'aria-label="Play video: {cap}"><img src="https://i.ytimg.com/vi/{src}/hqdefault.jpg" alt="" width="480" height="360">'
                f'<span>Play video</span></button><figcaption>{cap}</figcaption></figure>')
    if kind == "3d":
        return (f'<figure class="figure robot-fig"><div class="robot3d" data-demo="assets/3d/robots/robot-viewer.js" '
                f'data-model="{src}" data-label="3D model: {cap}. Drag to turn, scroll or pinch to zoom, arrow keys turn."></div>'
                f'<figcaption>{cap}</figcaption></figure>')
    raise ValueError(kind)


def activities_page():
    tiles, panels = [], []
    # Placeholder shapes vary so empty slots do not read as a uniform grid.
    shapes = [3 / 2, 4 / 5, 1.0, 4 / 3, 5 / 4]
    for n, a in enumerate(ACTIVITIES):
        if a["cover"]:
            src, alt = a["cover"]
            r = _ratio(src)
            media = f'<img class="jg-media" src="{src}" alt="" data-alt="{alt}">'
        else:
            r = shapes[n % len(shapes)]
            media = f'<div class="jg-media todo">Coming soon</div>'
        tiles.append(
            f'<li class="jg-item" style="--r:{r:.4f}" data-r="{r:.4f}">'
            f'<a class="jg-link" href="#{a["id"]}" data-act="{a["id"]}" aria-expanded="false">'
            f'<span class="jg-frame">{media}</span><span class="jg-label">{a["label"]}</span></a></li>')
        meta = "".join(
            f'<p class="act-{k}">{v}</p>' for k, v in (("years", a["years"]), ("role", a["role"])) if v)
        honors = ('<ul class="honors">' + "".join(f"<li>{h}</li>" for h in a["honors"]) + "</ul>") if a["honors"] else ""
        missing = ""
        if a["todo"] or not a["years"] or not a["role"]:
            items = list(a["todo"])
            missing = todo("More coming soon.", "todo-text") if items else ""
        more = "".join(_media(m) for m in a["more"])
        panels.append(f"""<template id="act-{a["id"]}" data-label="{a["label"]}">
<h2 class="act-title" id="act-title">{a["title"]}</h2>
{meta}{honors}
<div class="prose">{a["text"]}</div>
{missing}
{f'<div class="act-more">{more}</div>' if more else ""}
</template>""")
    body = f"""
<div class="wrap acts-head">
  <h1>Activities</h1>
  <p class="lede">Teams, clubs and events outside class.</p>
</div>
<section class="acts"><div class="wrap">
  <ul class="jg" aria-label="Activities">{"".join(tiles)}</ul>
</div></section>
{"".join(panels)}
<template id="act-shell"><li class="act-panel"><div class="act-inner">
  <figure class="act-cover"></figure>
  <div class="act-text">
    <div class="act-bar">
      <button type="button" class="act-btn act-prev" aria-label="Previous activity">&larr;<span class="act-btn-l">Previous</span></button>
      <button type="button" class="act-btn act-next" aria-label="Next activity"><span class="act-btn-l">Next</span>&rarr;</button>
      <button type="button" class="act-btn act-close">Close</button>
    </div>
    <div class="act-body"></div>
  </div>
</div></li></template>
<dialog class="lb" aria-label="Photo"><button type="button" class="act-btn lb-close">Close</button><img alt=""></dialog>
{IMPORTMAP}
<script src="assets/js/activities.js" defer></script>
"""
    return page("Activities · Vishesh Konduru", body, "activities.html",
                description="Teams, clubs and events outside class: VEX U, FRC, orchestra, outreach and more.")


def about_page():
    body = f"""
<div class="wrap about-top body-grid">
  <img class="portrait" src="assets/img/me.jpg" alt="Vishesh Konduru">
  <div>
    <h1>About me</h1>
    <div class="prose">
      <p>I'm graduating from WPI with a BS in Robotics Engineering and a minor in Computer Science in May 2027, and an MS in Robotics Engineering in December 2027.</p>
      <p>My interest in robotics started with my grandfather's cassette player and LEGO EV3 kits. I wanted to know how machines worked, and there's an old video of me at 2 years old working that cassette player to loop my favorite song. That curiosity carried me through twelve years of competitive robotics in FLL, FTC, FRC, VRC and VEX U.</p>
      <p>At WPI it has turned into an interest in how robots perceive their surroundings, plan their motion and control it. The areas I want to keep working in are perception, motion planning, controls, AI and machine learning for robots, multi-robot systems, and medical and soft robotics.</p>
      <p>I'm a U.S. permanent resident.</p>
    </div>
  </div>
</div>
<section>
  <div class="wrap body-grid">
    <h2 class="label">Coursework</h2>
    <div class="prose">
      <p><strong>Graduate:</strong> Robot Dynamics, Robot Control, Swarm Intelligence, Biomedical Robotics, Imaging for Medical Robotics.</p>
      <p><strong>Undergraduate:</strong> Unified Robotics I to IV, Control Engineering, Embedded Systems, Algorithms, Software Engineering, Object-Oriented Design, Intro to AI.</p>
    </div>
  </div>
</section>
<section>
  <div class="wrap body-grid">
    <h2 class="label">Outside class</h2>
    <div class="prose">
      <p>I've been a member of, and led, teams from 5 to 165 people. On WPI VEX U I have held several roles over the years: secretary, marketing head/media lead, build lead, driver and programmer. Since my freshman year I've helped build and program robots for the team's most successful, record-setting seasons. Building two robots for the VEX U World Championship whose designs and match strategies complement each other is the challenge I enjoy most, and it's where my interest in multi-robot systems comes from.</p>
      <p>Teaching and outreach have been a big part of robotics for me. In high school I helped organize more than sixty outreach and community events, mentored robotics teams, and taught STEM camps. As the Robotics Outreach Assistant with WPI Admissions, I organized robotics events, worked with FIRST and VEX/RECF, made Admissions content, and analyzed applicant and alumni data to plan outreach. I've also volunteered more than 400 hours at robotics competitions.</p>
      <p>I play violin in the WPI Orchestra, and have played for 10 years, through middle school and high school.</p>
      <figure class="figure"><img src="assets/img/activities/orchestra_wpi.jpg" alt="Playing violin with the WPI orchestra." width="2400" height="1596" loading="lazy" decoding="async"></figure>
    </div>
  </div>
</section>
<section>
  <div class="wrap body-grid">
    <h2 class="label">Contact</h2>
    <div class="links">
      <a class="local" href="mailto:{EMAIL}">{EMAIL}</a>
      <a href="{LINKEDIN}">LinkedIn</a>
      <a href="{GITHUB}">GitHub</a>
      <a class="local" href="{RESUME}">Resume</a>
    </div>
  </div>
</section>
"""
    return page("About · Vishesh Konduru", body, "about.html")


def _dims(html, base):
    """Intrinsic sizes on media, lazy loading, video posters, h2 ids and PDF sizes."""
    import re
    from PIL import Image

    def size(src):
        try:
            return Image.open((base / src).resolve()).size
        except Exception:
            return None
    first = [True]

    def img(m):
        tag, src = m.group(0), m.group(1)
        tag = tag.replace(' loading="lazy"', "")
        extra = ' decoding="async"'
        if first[0]:
            first[0] = False
        else:
            extra += ' loading="lazy"'
        if " width=" not in tag and not src.startswith("http"):
            wh = size(src)
            if wh:
                extra += f' width="{wh[0]}" height="{wh[1]}"'
        return tag[:-1] + extra + ">"
    html = re.sub(r'<img [^>]*src="([^"]+)"[^>]*>', img, html)

    def vid(m):
        tag, src = m.group(0), m.group(1)
        poster = src[:-4] + "_poster.jpg"
        wh = size(poster)
        tag = tag.replace('preload="metadata"', 'preload="none"')
        add = f' poster="{poster}"' + (f' width="{wh[0]}" height="{wh[1]}"' if wh else "")
        return tag[:-1] + add + ">"
    html = re.sub(r'<video src="([^"]+)"[^>]*>', vid, html)

    def hid(m):
        sid = re.sub(r"[^a-z0-9]+", "-", re.sub(r"<[^>]+>", "", m.group(2)).lower()).strip("-")
        return f'<h2{m.group(1)} id="{sid}">{m.group(2)}</h2>'
    html = re.sub(r'<h2((?: class="[^"]*")?)>(.*?)</h2>', hid, html)

    def pdf(m):
        p = (base / m.group(1)).resolve()
        if not p.exists():
            return m.group(0)
        mb = p.stat().st_size / 1e6
        sz = f"{mb:.0f} MB" if mb >= 1 else f"{p.stat().st_size // 1000} KB"
        return f'{m.group(0)[:-4]} <span class="size">(PDF, {sz})</span></a>'
    return html


def _ver(p):
    """Short content hash, so a changed file gets a new URL and an unchanged one keeps its cache."""
    return hashlib.sha1(p.read_bytes()).hexdigest()[:8]


def _bust(html, base):
    """Appends ?v=<hash> to local CSS and JS links (href, src, data-demo). On pages with an import
    map, also maps every demo module under assets/3d to its versioned URL, so relative imports
    inside the modules are refreshed too."""
    def ver(m):
        url = m.group(2)
        p = (base / url).resolve()
        if url.startswith(("http:", "https:", "//")) or not p.is_file():
            return m.group(0)
        return f'{m.group(1)}="{url}?v={_ver(p)}"'
    html = re.sub(r'\b(href|src|data-demo)="([^"?#:]+\.(?:css|js))"', ver, html)

    def media(m):  # loop videos and posters named in data-lite
        p = (base / m.group(0)).resolve()
        return f"{m.group(0)}?v={_ver(p)}" if p.is_file() else m.group(0)
    html = re.sub(r'(?:\.\./)*assets/lite/[\w.-]+\.(?:mp4|jpg)', media, html)

    def imap(m):
        data = json.loads(m.group(1))
        for p in sorted((ROOT / "assets" / "3d").rglob("*.js")):
            rel = os.path.relpath(p, base).replace(os.sep, "/")
            if not rel.startswith("."):
                rel = "./" + rel
            data["imports"][rel] = f"{rel}?v={_ver(p)}"
        return f'<script type="importmap">{json.dumps(data, separators=(",", ":"))}</script>'
    return re.sub(r'<script type="importmap">(.*?)</script>', imap, html, flags=re.S)


def write(path, html):
    a, b = html.index("<main"), html.index("</main>")
    html = html[:a] + _dims(html[a:b], path.parent) + html[b:]
    html = _bust(html, path.parent)
    path.write_text(html, encoding="utf-8")


def main():
    write(ROOT / "index.html", index_page())
    write(ROOT / "activities.html", activities_page())
    (ROOT / "journey.html").write_text(JOURNEY_REDIRECT, encoding="utf-8")
    write(ROOT / "about.html", about_page())
    (ROOT / "projects").mkdir(exist_ok=True)
    n = len(PROJECTS)
    for i, p in enumerate(PROJECTS):
        html = project_page(p, PROJECTS[i - 1], PROJECTS[(i + 1) % n])
        write(ROOT / "projects" / f'{p["slug"]}.html', html)
    print(f"built {3 + n} pages")


if __name__ == "__main__":
    main()
