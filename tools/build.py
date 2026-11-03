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
<link href="https://fonts.googleapis.com/css2?family=IBM+Plex+Mono:wght@400;500&family=IBM+Plex+Sans:wght@400;500;600&display=swap" rel="stylesheet">
<link rel="stylesheet" href="{up}assets/css/site.css">
</head>
<body>
<header class="site-head">
  <div class="edge head-inner">
    <a class="site-name" href="{up}index.html">Vishesh Konduru</a>
    <nav class="site-nav">{nav}</nav>
  </div>
</header>
<main>
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


def project_page(p, prev, nxt):
    links = ""
    if p["links"]:
        items = "".join(
            f'<a href="{l[1]}" class="{l[2] if len(l) > 2 else ""}">{l[0]}</a>' for l in p["links"]
        )
        links = f'<div class="links top-links">{items}</div>'
    body = f"""
<article class="wrap project-head">
  <div class="article">
    <h1>{p["title"]}</h1>
    <p class="meta">{p["meta"]}</p>
    {honors_block(p)}
    {links}
    {"".join(p["body"])}
  </div>
</article>
<section><div class="wrap pager">
  <a href="{prev["slug"]}.html">&larr; {prev["short"]}</a>
  <a href="{nxt["slug"]}.html">{nxt["short"]} &rarr;</a>
</div></section>
"""
    return page(f'{p["short"]} · Vishesh Konduru', body, "", depth=1, description=p["blurb"])


def index_page():
    items = []
    for p in PROJECTS:
        thumb = (f'<img class="thumb" src="{p["thumb"]}" alt="" loading="lazy">' if p["thumb"]
                 else '<div class="thumb todo">Screenshot coming soon</div>')
        tags = "".join(f'<span class="tag">{t}</span>' for t in p["tags"])
        items.append(f"""<a class="work-item" href="projects/{p["slug"]}.html">
  {thumb}
  <div>
    <h3>{p["title"]}</h3>
    {honors_card(p)}
    <p>{p["blurb"]}</p>
    <div class="tags">{tags}</div>
  </div>
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
    <div class="work">{"".join(items)}</div>
  </div>
</section>

<section>
  <div class="wrap">
    <div class="section-head"><h2>Recognition</h2></div>
    <div class="rows">
      <div class="row"><span class="when">2026</span><div><strong>Paper accepted to the NeurIPS 2026 ML4Molecules workshop</strong><p>Co-first author, <a href="https://openreview.net/forum?id=QrZdMrLP5X"><em>Heimdall: An Agentic Eye for Chemistry</em></a>.</p></div></div>
      <div class="row"><span class="when">2026</span><div><strong>Nominated for WPI's President's IQP Award</strong><p>For <a href="projects/iqp.html">Giving Shells a New Life</a>.</p></div></div>
      <div class="row"><span class="when">2026</span><div><strong>Nominated for the Award for Academic Achievement Abroad</strong><p>From the Forum on Education Abroad, for the same project.</p></div></div>
      <div class="row"><span class="when">2023 to now</span><div><strong>VEX U World Championship</strong><p>Competed with WPI's VEX U team. See the <a href="journey.html">journey</a>.</p></div></div>
    </div>
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
             ['<figure class="figure"><iframe class="short" src="https://www.youtube-nocookie.com/embed/1kmXXycRsSI" title="VEX U 2024-25 endgame climb interview" loading="lazy" allow="encrypted-media; picture-in-picture" allowfullscreen></iframe></figure>',
              '<figure class="figure"><video src="assets/video/vex_worlds.mp4" autoplay muted loop playsinline preload="metadata"></video><figcaption>A match from the driver&rsquo;s spot, May 2025.</figcaption></figure>']),
        stop("Early 2026", "Thailand", "Interactive Qualifying Project",
             '<p>In Bangkok and Angsila, working on oyster shell waste with students from Chulalongkorn University. <a href="projects/iqp.html">Read about the project</a>.</p>',
             [img("assets/img/iqp/farm.jpg", "Oyster farm off Angsila.", "crop", depth=0),
              img("assets/img/iqp/interview.jpg", "Field interviews.", "crop", depth=0)]),
        stop("2025 to 2026", "WPI VEX U, Push Back", "and the autonomous robot",
             '<p>Our MQP team built a robot that plays the whole match by itself. <a href="projects/mqp.html">Read about the robot</a>.</p>',
             [img("assets/img/mqp/robot.jpg", "The autonomous robot.", "crop", depth=0),
              todo("Photo: VEX U World Championship")]),
        stop("2026", "Cavall Labs and NeurIPS", "",
             '<p>Started at Cavall Labs in March 2026. Our paper on Heimdall was accepted to the NeurIPS 2026 ML4Molecules workshop. <a href="projects/heimdall.html">Read about Heimdall</a>.</p>',
             []),
    ]
    body = f"""
<div class="wrap project-head">
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


def main():
    (ROOT / "index.html").write_text(index_page(), encoding="utf-8")
    (ROOT / "journey.html").write_text(journey_page(), encoding="utf-8")
    (ROOT / "about.html").write_text(about_page(), encoding="utf-8")
    (ROOT / "projects").mkdir(exist_ok=True)
    n = len(PROJECTS)
    for i, p in enumerate(PROJECTS):
        html = project_page(p, PROJECTS[i - 1], PROJECTS[(i + 1) % n])
        (ROOT / "projects" / f'{p["slug"]}.html').write_text(html, encoding="utf-8")
    print(f"built {3 + n} pages")


if __name__ == "__main__":
    main()
