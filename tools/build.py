"""Builds the static pages from the content below.

Run:  python tools/build.py
Output is plain HTML in the repo root and projects/. GitHub Pages serves it as is.
Edit text here, not in the generated .html files, or your edits will be overwritten.
"""
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent

EMAIL = "vishesh-konduru@outlook.com"
LINKEDIN = "https://www.linkedin.com/in/visheshkonduru"
GITHUB = "https://github.com/VisheshKonduru"
RESUME = "docs/Vishesh_Konduru_Resume.pdf"

NAV = [("index.html", "Work"), ("journey.html", "Journey"), ("about.html", "About")]


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
<link href="https://fonts.googleapis.com/css2?family=Source+Sans+3:wght@400;600&family=Source+Serif+4:opsz,wght@8..60,400;8..60,600&display=swap" rel="stylesheet">
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
<footer class="site-foot">
  <div class="wrap">
    <span>Vishesh Konduru</span>
    <span><a href="mailto:{EMAIL}">{EMAIL}</a> &nbsp;·&nbsp; <a href="{LINKEDIN}">LinkedIn</a> &nbsp;·&nbsp; <a href="{GITHUB}">GitHub</a></span>
  </div>
</footer>
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
from projects_content import PROJECTS  # noqa: E402


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
    <dl class="spec">
      <div><dt>Context</dt><dd>{p["meta"]}</dd></div>
      <div><dt>Dates</dt><dd>{_year(p)}</dd></div>
      {f'<div><dt>Tools</dt><dd>{", ".join(p["tags"])}</dd></div>' if p.get("tags") else ""}
      {f'<div><dt>Links</dt><dd>{links}</dd></div>' if links else ""}
    </dl>
  </header>
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
        items.append(f"""<a class="entry{" no-img" if not thumb else ""}" href="projects/{p["slug"]}.html">
  <span class="entry-year">{_year(p)}</span>
  <div class="entry-text">
    <h3>{p["title"]}</h3>
    {honors_card(p)}
    <p>{p["blurb"]}</p>
  </div>
  {thumb}
</a>""")
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
    </div>
  </div>
</section>

<section>
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


def journey_page():
    def stop(year, title, sub, text, figs):
        return f"""<div class="stop">
  <div class="year">{year}</div>
  <div>
    <h2>{title}</h2>
    <p class="sub">{sub}</p>
    <div class="prose">{text}</div>
    <div class="gallery">{"".join(figs)}</div>
  </div>
</div>"""

    stops = [
        stop("High school", "FRC and VEX", "Where it started",
             "<p>I started building robots in high school on FRC and VEX teams.</p>",
             ['<figure class="figure"><video src="assets/video/hs_outreach.mp4" autoplay muted loop playsinline preload="metadata"></video><figcaption>FRC Team 3735 VorTX at Siemens Energy Day.</figcaption></figure>',
              '<figure class="figure"><video src="assets/video/hs_frc_climb.mp4" autoplay muted loop playsinline preload="metadata"></video><figcaption>Our 2021-22 FRC robot climbing in the endgame.</figcaption></figure>',
              todo("Photo: high school VEX robot")]),
        stop("2023 to 2024", "WPI VEX U, Over Under", "First season in college",
             "<p>Joined WPI's VEX U team in April 2023.</p>",
             [todo("Photo: 2023-24 robot"), todo("Video or photo: 2023-24 season")]),
        stop("2024 to 2025", "WPI VEX U, High Stakes", "",
             "<p>A short interview about our endgame climb mechanism.</p>",
             ['<figure class="figure"><button class="yt short" type="button" data-id="1kmXXycRsSI" data-title="VEX U 2024-25 endgame climb interview" aria-label="Play video: VEX U 2024-25 endgame climb interview"><img src="https://i.ytimg.com/vi/1kmXXycRsSI/hqdefault.jpg" alt="" width="480" height="360"><span>Play video</span></button></figure>',
              '<figure class="figure"><video src="assets/video/vex_worlds.mp4" autoplay muted loop playsinline preload="metadata"></video><figcaption>A match from the driver&rsquo;s spot, May 2025.</figcaption></figure>']),
        stop("2025 to 2026", "WPI VEX U, Push Back", "and the autonomous robot",
             '<p>Our MQP team built a robot that plays the whole match by itself. <a href="projects/mqp.html">Read about the robot</a>.</p>',
             [img("assets/img/mqp/robot.jpg", "The autonomous robot.", depth=0),
              todo("Photo: VEX U World Championship")]),
        stop("Early 2026", "Thailand", "Interactive Qualifying Project",
             '<p>In Bangkok and Angsila, working on oyster shell waste with students from Chulalongkorn University. <a href="projects/iqp.html">Read about the project</a>.</p>',
             [img("assets/img/iqp/farm.jpg", "Oyster farm off Angsila.", depth=0),
              img("assets/img/iqp/interview.jpg", "Field interviews.", depth=0)]),
        stop("2026", "Cavall Labs and NeurIPS", "",
             '<p>Started at Cavall Labs in March 2026. Our paper on Heimdall was accepted to the NeurIPS 2026 ML4Molecules workshop. <a href="projects/heimdall.html">Read about Heimdall</a>.</p>',
             []),
    ]
    body = f"""
<div class="wrap journey-head">
  <h1>Robots, mostly, since high school</h1>
  <p class="lede">The teams, seasons and trips that got me here.</p>
</div>
<section><div class="wrap timeline">{"".join(stops)}</div></section>
"""
    return page("Journey · Vishesh Konduru", body, "journey.html")


def about_page():
    body = f"""
<div class="wrap about-top body-grid">
  <img class="portrait" src="assets/img/me.jpg" alt="Vishesh Konduru">
  <div>
    <h1>About me</h1>
    <div class="prose">
      <p>I'm in WPI's combined BS and MS program in Robotics Engineering, with a minor in Computer Science, finishing in December 2027. I like work where hardware and software meet: robots that have to see and decide on their own, sensors that need careful signal processing, and tools that real people use every day.</p>
      <p>I'm U.S. work authorized and don't need sponsorship.</p>
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
      <p>I've volunteered more than 400 hours at VEX, FRC, FTC and FLL competitions. I also play in orchestra at WPI, and did in high school.</p>
      <div class="gallery">{todo("Photo: orchestra")}{todo("Photo: volunteering at a competition")}</div>
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


def write(path, html):
    a, b = html.index("<main"), html.index("</main>")
    html = html[:a] + _dims(html[a:b], path.parent) + html[b:]
    path.write_text(html, encoding="utf-8")


def main():
    write(ROOT / "index.html", index_page())
    write(ROOT / "journey.html", journey_page())
    write(ROOT / "about.html", about_page())
    (ROOT / "projects").mkdir(exist_ok=True)
    n = len(PROJECTS)
    for i, p in enumerate(PROJECTS):
        html = project_page(p, PROJECTS[i - 1], PROJECTS[(i + 1) % n])
        write(ROOT / "projects" / f'{p["slug"]}.html', html)
    print(f"built {3 + n} pages")


if __name__ == "__main__":
    main()
